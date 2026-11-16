# Snake Arena

Jogo da cobrinha multiplayer PVP em tempo real, feito para a disciplina de Sistemas Distribuídos.
Um API Gateway fica na frente de três serviços internos, um deles SOAP em Python.

```
Cliente Web ──► API Gateway ──┬──► API de jogadores ──► SQLite
(REST + WS +    │             │          ▲
 SOAP)          │             ├──► API de jogo ──SOAP──┐
                │             │                        ▼
                └─────────────┴──► API de customização (SOAP) ──► SQLite
```

| Pasta | Peça | Porta |
|---|---|---|
| `gateway/` | API Gateway: JWT, HATEOAS, Swagger, proxy REST e WebSocket | 3000 (rede) |
| `players-api/` | Jogadores, partidas, ranking e emissão do JWT (`bun:sqlite`) | 3001 (só local) |
| `game-api/` | Loop da arena via WebSocket e estado da arena via REST | 3002 (só local) |
| `cosmetics-api/` | Acessórios das cobrinhas via SOAP 1.1 (Python + Spyne, `sqlite3`) | 3003 (só local) |
| `client/` | Cliente web em React | 5173 (rede) |
| `shared/` | Tipos do protocolo e cliente SOAP (Envelope e parser XML feitos à mão) | - |

## Como rodar

Requer [Bun](https://bun.sh) 1.3 ou mais novo e [uv](https://docs.astral.sh/uv/). O serviço SOAP
usa Python 3.11, porque o Spyne 2.14 (última versão) não roda do 3.12 em diante. O `uv` baixa
essa versão sozinho na primeira execução, então a máquina precisa de internet nesse momento.

```sh
bun install
bun run dev     # sobe as quatro peças com recarga automática
```

- Jogo: <http://localhost:5173>
- Documentação do gateway (Swagger): <http://localhost:3000/docs>
- Contrato SOAP (para o SoapUI): <http://localhost:3000/soap/cosmetics?wsdl>

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

## Serviço SOAP de customização

O gateway repassa `POST /soap/cosmetics` ao serviço Python sem alterar o Envelope e entrega o
WSDL com o `soap:address` apontando para o próprio gateway. Há dois consumidores em TypeScript:
o cliente web (tela de acessórios, com um painel que mostra o XML trocado) e a API de jogo, que
busca os acessórios de cada jogador ao nascer e os inclui no estado da arena.

| Operação | Entrada | Autenticação |
|---|---|---|
| `ListAccessories` | `slot` opcional (`head` ou `face`) | - |
| `GetCustomization` | `playerId` | - |
| `SetCustomization` | `head` e `face`, ambos opcionais | JWT em `soap:Header/AuthHeader/token` |

Erros voltam como `soap:Fault` com HTTP 500: `Client.SchemaValidationError` (entrada fora do
XML Schema do WSDL), `Client.UnknownAccessory`, `Client.WrongSlot`, `Client.Unauthorized` e
`Client.XMLSyntaxError`. Se o serviço estiver fora do ar, o gateway responde com um Fault
`Server` e HTTP 502.

```sh
bun run test   # inclui os testes do serviço SOAP (unittest)
```


Comparação entre os dois estilos e justificativa das escolhas: [docs/soap-vs-rest.md](docs/soap-vs-rest.md).
