# SOAP e REST no Snake Arena

O projeto usa os dois estilos lado a lado: o gateway expõe uma API REST com HATEOAS para jogadores,
partidas, ranking e arenas, e um serviço SOAP para a customização das cobrinhas. Este texto compara
os dois a partir do que foi implementado e justifica onde cada um entrou.

## Diferenças na prática

| Aspecto | REST (gateway, players-api, game-api) | SOAP (cosmetics-api) |
|---|---|---|
| Unidade de comunicação | Recurso identificado por URL (`/players/7`) e manipulado pelos verbos HTTP | Operação nomeada (`SetCustomization`) dentro de um Envelope XML, sempre por `POST` no mesmo endpoint |
| Formato | JSON | XML com Envelope, Header e Body em namespaces definidos |
| Contrato | OpenAPI gerado a partir dos schemas Zod, servido no Swagger. É documentação: o cliente não precisa dele para funcionar | WSDL com XML Schema. É o próprio contrato: o servidor valida cada requisição contra ele e o SoapUI monta as chamadas a partir dele |
| Validação de entrada | Zod no gateway, com mensagens próprias (`400 validation_error`) | Validação `lxml` do Spyne contra o schema do WSDL (`Client.SchemaValidationError`), antes de o código da operação rodar |
| Erros | Status HTTP com significado (`401`, `404`, `409`) e corpo JSON `{ error: { code, message } }` | `soap:Fault` com `faultcode` e `faultstring`; no SOAP 1.1 todo Fault vai com HTTP 500, e quem diz o tipo do erro é o `faultcode` (`Client.WrongSlot`, `Client.Unauthorized`) |
| Autenticação | `Authorization: Bearer <jwt>`, um cabeçalho HTTP, verificado pelo gateway | Token dentro da mensagem, em `soap:Header/AuthHeader`, verificado pelo próprio serviço |
| Descoberta | HATEOAS: o cliente só conhece a raiz e segue os `_links` | Nenhuma em tempo de execução: o cliente conhece as operações pelo WSDL |
| Tamanho da mensagem | A resposta de `GetCustomization` em JSON teria 50 bytes | A mesma resposta em SOAP tem 399 bytes, cerca de 8 vezes mais |
| Cache e intermediários | `GET` pode ser cacheado por qualquer proxy HTTP | Tudo é `POST` no mesmo endereço, então caches HTTP não ajudam |
| Ferramentas | `fetch` e `JSON.parse` em qualquer linguagem | Precisa montar e ler XML com namespaces; aqui isso foi feito à mão em `shared/src/soap.ts` e `xml.ts` |

## Por que a customização ficou em SOAP

- **O domínio é um contrato pequeno e fechado.** São três operações com tipos bem definidos: um
  catálogo fixo, dois espaços (`head` e `face`) e ids de acessório com formato restrito. Esse tipo de
  regra cabe bem num XML Schema, e o WSDL passa a ser a especificação que o servidor e os clientes
  seguem.
- **A validação sai do contrato.** O `enumeration` de `Slot`, o `pattern` de `AccessoryId` e o
  `minInclusive` de `PlayerId` estão no WSDL, e o servidor recusa sozinho o que não obedece. No
  REST, a mesma garantia exigiu escrever os schemas Zod à parte.
- **A interoperabilidade é real.** O servidor é Python e os clientes são TypeScript (navegador e
  game-api). Eles só têm em comum o WSDL e o formato do Envelope; nenhum código é compartilhado
  entre as duas linguagens.
- **Não é tempo real.** A customização acontece algumas vezes por sessão, fora da partida, então o
  custo maior do XML não faz diferença.

## Por que o resto continuou em REST e WebSocket

- **O jogo é tempo real.** O estado da arena vai para todos os jogadores a cada 110 ms. Em SOAP,
  cada tick viraria um Envelope XML várias vezes maior e um `POST` novo; o WebSocket com JSON manda
  só o necessário, numa conexão aberta, e nos dois sentidos. SOAP não tem um modelo de envio do
  servidor para o cliente.
- **Ranking, jogadores e partidas são recursos.** Eles se encaixam nos verbos HTTP, podem ser
  cacheados e se beneficiam do HATEOAS: o cliente segue `_links` em vez de montar URLs.
- **O navegador fala JSON nativamente.** Para SOAP no navegador foi preciso um parser XML próprio;
  para REST bastou `fetch`.

## Decisões técnicas da implementação

- **Token no `soap:Header`, validado pelo serviço.** No REST o JWT vai no cabeçalho HTTP e o
  gateway confere. No SOAP preferimos colocar o token na mensagem: o Header existe justamente para
  metadados como autenticação, a exigência fica declarada no WSDL (o binding de `SetCustomization`
  inclui `AuthHeader`) e a mensagem continua válida independentemente do transporte. Por isso o
  gateway só repassa o Envelope, sem abrir o XML.
- **Gateway como passagem transparente.** O gateway continua sendo a única porta na rede, mas não
  converte SOAP em JSON. Converter tiraria o SOAP do caminho do cliente, e a atividade pede um
  consumidor SOAP de verdade. O único ajuste é no WSDL: o `soap:address` interno
  (`127.0.0.1:3003`) é trocado pelo endereço público do gateway, senão o SoapUI em outra máquina
  tentaria chamar um endereço inacessível.
- **Style document/literal.** O Body carrega um elemento com o nome da operação e os parâmetros
  como filhos, todos no namespace `urn:snake-arena:cosmetics`. É o estilo que o WS-I Basic Profile
  recomenda e o que permite validar o Body inteiro contra o schema.
- **Cliente SOAP sem gerador de código.** Os clientes montam o Envelope e leem a resposta com um
  parser escrito no projeto, resolvendo os namespaces pelas declarações `xmlns`. Isso evita
  frameworks que escondem o SOAP e deixa visível, no painel "Ver XML" do cliente, exatamente o que
  trafega.
- **Faults em vez de status HTTP.** Como o SOAP 1.1 usa HTTP 500 para todo Fault, os clientes não
  olham o status: leem o `faultcode` e tratam `Client.*` como erro de quem chamou (mostrado ao
  jogador) e o restante como falha do servidor. A única exceção é o gateway, que responde 502 com
  um Fault `Server` quando o serviço está fora do ar, para indicar que o problema é interno.
- **Falha do SOAP não derruba o jogo.** A game-api busca os acessórios depois de colocar a cobrinha
  na arena. Se o serviço não responder, o jogador joga sem acessórios. A customização é um recurso
  secundário e não deve virar ponto único de falha da partida.

## Resumo

SOAP valeu pelo contrato formal: tipos, validação e operações descritos num WSDL que servidor e
clientes de linguagens diferentes seguem, com erros padronizados. REST valeu pela simplicidade, pelo
uso do HTTP como ele é (verbos, status, cache) e pela navegação por links. Para o fluxo em tempo
real, nenhum dos dois serve: lá o WebSocket é a escolha certa.
