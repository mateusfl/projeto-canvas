# WebSocket no Snake Arena

A partida acontece toda por WebSocket: o servidor manda o estado da arena a cada tick (110 ms)
para todos os jogadores, e cada jogador manda suas viradas pela mesma conexão. Este texto descreve
como isso foi feito e as decisões que o enunciado pede.

## Peças

```
Navegador ──ws──► Gateway (valida o JWT) ──ws──► API de jogo
   ▲                                               │ publish("arena:1")
   └──────────────── state a cada tick ◄───────────┘
```

- **Servidor:** a API de jogo (`game-api/src/index.ts`), com o servidor WebSocket nativo do Bun,
  construído sobre o uWebSockets.
- **Cliente:** a API `WebSocket` nativa do navegador (`client/src/Game.tsx`). Nenhuma biblioteca
  esconde o protocolo; a URL `ws://<host>:3000/arenas/1/play?token=...` chega ao cliente pelo link
  HATEOAS `play`.
- **Gateway:** faz proxy da conexão. Mantém duas conexões por jogador (navegador → gateway e
  gateway → API de jogo), repassa as mensagens nos dois sentidos e guarda as que chegam enquanto
  a conexão com a API de jogo ainda está abrindo.

## Mensagens

| Sentido | Mensagem | Quando |
|---|---|---|
| Cliente → servidor | `{type:"dir", dir}` | O jogador vira (setas, WASD ou gesto) |
| Cliente → servidor | `{type:"respawn"}` | O jogador pede para renascer |
| Servidor → um cliente | `{type:"welcome", playerId, arena}` | Logo após a conexão abrir |
| Servidor → um cliente | `{type:"dead", score, kills, killedBy}` | O jogador foi eliminado |
| Servidor → **todos** | `{type:"state", tick, snakes, food}` | A cada tick, em broadcast |

O broadcast usa o pub/sub do Bun: cada conexão se inscreve no tópico `arena:<id>` ao abrir, e o
loop da arena publica o estado uma vez por tick nesse tópico. O servidor não percorre a lista de
conexões; o Bun entrega a mensagem a todos os inscritos.

## Ciclo de vida

1. **Abertura:** o cliente abre `ws://.../arenas/1/play?token=<jwt>`. O gateway valida o token e
   abre a conexão com a API de jogo, que coloca a cobrinha na arena, inscreve a conexão no tópico
   e responde com `welcome`.
2. **Envio:** o cliente só envia com a conexão aberta (`readyState === OPEN`).
3. **Recebimento:** cada `state` redesenha a arena e o placar; `dead` abre a tela de eliminação.
4. **Encerramento:** ao fechar, a cobrinha vira comida e a partida é registrada na API de
   jogadores. O cliente mostra o motivo quando o código de fechamento é conhecido.

O servidor registra no console a abertura, cada mensagem recebida e o encerramento:

```
[ws] ana (#27): conexão aberta na arena 1
[ws] ana (#27): mensagem recebida {"type":"dir","dir":"up"}
[ws] ana (#27): conexão encerrada (código 1000, saiu do jogo)
```

O cliente registra o mesmo ciclo no console do navegador, com o prefixo `[ws]`. Do `state`, só o
primeiro aparece, porque os seguintes chegam a cada 110 ms.

## Decisões

**Como identificar os clientes.** Pelo id do jogador, que vem no JWT. O navegador não consegue
enviar o cabeçalho `Authorization` no handshake do WebSocket, então o token vai na query string; o
gateway valida e repassa a identidade à API de jogo. Cada login também tem um `sessionId`, que
diferencia uma reconexão (mesma sessão, por exemplo a página recarregada) de outra pessoa tentando
usar o mesmo nome.

**Como armazenar as conexões ativas.** Em duas estruturas por arena, cada uma com uma função:

- um `Map<playerId, socket>`, para as mensagens individuais (`welcome`, `dead`) e para saber
  quem está conectado;
- o tópico pub/sub `arena:<id>`, para o broadcast do estado.

**Como tratar clientes desconectados.** No `close`, o jogador sai do `Map`, a cobrinha vira comida
e a partida é registrada. Conexões que caem sem aviso (rede ou cabo) são detectadas pelos pings
automáticos e pelo tempo máximo de inatividade do servidor do Bun, que disparam o mesmo `close`.
Os casos especiais têm códigos de fechamento próprios, que o cliente traduz em mensagens:

| Código | Significado |
|---|---|
| `4000` | A mesma sessão conectou em outra aba; a conexão antiga é encerrada |
| `4401` | Token ausente, inválido ou expirado |
| `4404` | Arena não encontrada |
| `4409` | Já existe outro jogador com esse nome na arena |
| `1011` | O gateway não conseguiu falar com a API de jogo |

**Formato das mensagens.** JSON, com um campo `type` que identifica cada mensagem. Os tipos
(`ClientMessage` e `ServerMessage`) ficam definidos uma única vez em `shared/src/index.ts` e são
usados pelo servidor e pelo cliente, então o TypeScript confere que os dois falam o mesmo formato.
Texto simples não daria conta de mandar as posições de várias cobrinhas e da comida em cada tick.

## Por que WebSocket e não polling ou REST

O próprio projeto tem os dois modelos lado a lado. O ranking usa requisição e resposta: o cliente
pede `GET /leaderboard` quando o jogador é eliminado e recebe a resposta uma vez. A arena usa
WebSocket, porque o estado muda a cada 110 ms e precisa chegar a todos ao mesmo tempo.

- **Polling** obrigaria cada jogador a fazer cerca de 9 requisições por segundo, cada uma com
  cabeçalhos HTTP completos; com 10 jogadores seriam uns 90 pedidos por segundo só para acompanhar
  a partida. Ainda assim haveria atraso, porque o estado novo só chega no próximo pedido, que não
  está sincronizado com o tick.
- **REST para os comandos** transformaria cada tecla em um `POST` novo, com uma conexão e uma
  resposta para cada virada.
- **Com WebSocket**, a conexão é aberta uma vez e fica aberta nos dois sentidos. O servidor publica
  uma vez por tick e todos recebem juntos, com poucos bytes de enquadramento por mensagem, e as
  viradas do jogador seguem pela mesma conexão.
