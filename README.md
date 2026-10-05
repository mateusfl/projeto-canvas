# Snake Arena

Jogo da cobrinha multiplayer PVP em tempo real, feito para a disciplina de Sistemas Distribuídos.
Um API Gateway fica na frente de duas APIs internas.

```
Cliente Web ──► API Gateway ──┬──► API de jogadores ──► SQLite
  (REST + WS)                 │          ▲
                              └──► API de jogo
```

| Pasta | Peça | Porta |
|---|---|---|
| `gateway/` | API Gateway: JWT, HATEOAS, Swagger, proxy REST e WebSocket | 3000 (rede) |
| `players-api/` | Jogadores, partidas, ranking e emissão do JWT (`bun:sqlite`) | 3001 (só local) |
| `game-api/` | Loop da arena via WebSocket e estado da arena via REST | 3002 (só local) |
| `client/` | Cliente web em React | 5173 (rede) |
| `shared/` | Tipos do protocolo usados pelas peças | - |

## Como rodar

Requer [Bun](https://bun.sh) 1.3 ou mais novo.

```sh
bun install
bun run dev     # sobe as quatro peças com recarga automática
```

- Jogo: <http://localhost:5173>
- Documentação do gateway (Swagger): <http://localhost:3000/docs>

De outra máquina da rede, troque `localhost` pelo IP de quem está rodando o servidor. O cliente
descobre o gateway pelo host da própria página.

Para a apresentação, usar `bun run start` (sem recarga automática) e defina um segredo próprio:

```sh
JWT_SECRET="um-segredo-qualquer" bun run start
```

## Configuração

Tudo tem valor padrão; as variáveis de ambiente só servem para ajustar.

| Variável | Padrão | Uso |
|---|---|---|
| `JWT_SECRET` | segredo de desenvolvimento | Assinatura do JWT (API de jogadores e gateway) |
| `GRID_WIDTH`, `GRID_HEIGHT` | `100` | Tamanho da arena em células |
| `TICK_MS` | `110` | Intervalo entre os ticks do jogo |
| `FOOD_TARGET` | `180` | Quantidade de comida mantida na arena |
| `PLAYERS_DB` | `players-api/players.sqlite` | Arquivo do banco |

## Desenvolvimento

```sh
bun test            # testes da lógica da arena
bun run typecheck   # checagem de tipos
bun run format      # formata e aplica correções do Biome
bun run check       # só verifica, sem alterar arquivos
```
