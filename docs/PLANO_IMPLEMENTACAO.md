Atue como Engenheiro de Software Sênior especialista em Electron, Angular e Node.js.

Quero construir do zero um cliente de API desktop (alternativa offline ao Postman/Insomnia/Bruno) focado em controle de versão, arquitetura robusta e privacidade total.

---

### Premissas e Arquitetura

1. **Stack Tecnológica:**
   - **Runtime:** Node.js v22 (LTS).
   - **Shell Desktop:** Electron (versão estável compatível com Node 22).
   - **Frontend:** Angular (Standalone Components, Signals, RxJS).
   - **Banco de Dados Embutido:** SQLite local embutido gerenciado no processo Node via `better-sqlite3` ou SQLite nativo do Node 22.
   - **Comunicação:** IPC seguro via `contextBridge` / `preload.ts` (`contextIsolation: true`, `nodeIntegration: false`).

2. **Princípios de Design (SOLID):**
   - **S (Responsabilidade Única):** Serviços desacoplados para HTTP, persistência SQLite, sincronização de arquivos e interface.
   - **O (Aberto/Fechado):** Estrutura extensível de parsers (OpenAPI, Postman, etc.) e adaptadores sem alterar o core.
   - **L (Substituição de Liskov):** Contratos de repositório e parsers baseados em interfaces bem definidas.
   - **I (Segregação de Interfaces):** Interfaces granulares para entidades, schemas e sincronização.
   - **D (Inversão de Dependência):** Injeção de dependência nativa no Angular e contratos/interfaces no processo principal do Electron.

3. **Paradigma Local-First e Offline:**
   - 100% offline: sem telemetria, sem autenticação remota e sem servidores proprietários.
   - Metadados, histórico, abas ativas e configurações salvas no SQLite embutido.
   - Coleções salvas localmente no sistema de arquivos em formato legível (compatível com Git).
   - Chamadas HTTP executadas via processo Node (livres de CORS).

4. **Andamento:**
   - Crie e mantenha um arquivo Markdown (PROGRESS.md) na raiz do projeto para registrar o status de cada fase.
   - Atualize esse documento dinamicamente a cada entrega, alteração de escopo ou conclusão de etapa, marcando itens finalizados e registrando ajustes técnicos.
   - O arquivo deve funcionar como a fonte da verdade sobre o estado atual do software, servindo de memória contínua para orientar os próximos passos do desenvolvimento.

---

### Funcionalidades Principais

- **Banco de Dados Embutido:** Histórico, métricas, abas ativas, ambientes e preferências.
- **Coleções e Requisições:** Métodos HTTP padrão, Headers, Query Params, Auth e Body.
- **Ambientes e Variáveis:** Interpolação via `{{variavel}}`.
- **Painel de Resposta:** Tempo, status code, tamanho e syntax highlighting com JSON formatado.
- **Configurações Gerais do Sistema:**
  - Preferências globais (proxy, timeout, certificados SSL).
  - Controle centralizado de aparência: suporte nativo a **Light**, **Dark** e **Auto** (sincronizado com o sistema operacional).
- **Visão Detalhada da Collection (Padrão Bruno):**
  - Ao clicar na raiz da coleção, exibir uma aba principal de detalhes com cabeçalho de abas secundárias: `Overview`, `Headers`, `Vars`, `Auth`, `Script`, `Tests`, `Presets`, `Proxy`, `Client Certificates`, `Secrets`, `Protobuf`.
  - No painel `Overview`: exibir cards com **Location** (caminho local), **Version**, **Environments**, **Requests** (total), **Share** e bloco lateral de **Documentation** em Markdown.
- **Importação e Sincronização OpenAPI / Web:**
  - Importação direta via URL de especificação ou arquivo local.
  - Monitoramento de alterações no endpoint da especificação de origem.
  - Botão de verificação/atualização com diálogo de resolução de conflitos (Merge Diff: tabela comparativa entre alterações locais e remotas para escolha do usuário).

---

### Roteiro de Execução Passo a Passo

Construa o projeto de forma modular, aplicando SOLID em cada camada e entregando o código completo de cada arquivo sem omissões.

- **Etapa 1: Setup do Boilerplate e Estrutura SOLID**
  - Setup de projeto integrado: Electron + Angular + TypeScript (Node 22).
  - Organização de pastas seguindo contratos de interface e separação entre `main`, `preload` e `renderer`.
  - Configuração de build e concorrência (`package.json`, `tsconfig.json`).

- **Etapa 2: Banco de Dados Embutido (SQLite)**
  - Configuração do driver SQLite local no processo principal do Electron.
  - Schemas e migrações para: `settings`, `history`, `tabs`, `environments` e `collections_metadata`.
  - Repositories baseados em interfaces (DIP) e canais IPC para CRUD.

- **Etapa 3: Configuração Geral do Sistema e Temas**
  - Painel global de configurações e persistência no SQLite.
  - Seletor de aparência: **Light**, **Dark** e **Auto** via `nativeTheme` e Signals do Angular.

- **Etapa 4: Ponte IPC e Sistema de Arquivos (Local-First)**
  - IPCs para leitura/escrita de coleções no sistema de arquivos local.
  - Mapeamento entre disco e banco de dados local.

- **Etapa 5: Motor de Requisições HTTP (Node 22)**
  - Executor HTTP no processo Node (`undici` ou `fetch` nativo).
  - Registro de histórico e métricas no SQLite.

- **Etapa 6: Interface Angular (Layout Base e Abas)**
  - Barra lateral com árvore de diretórios/coleções e sistema de abas de navegação.
  - Aplicação dos estilos globais baseados no tema ativo.

- **Etapa 7: Editor de Requisição, Resposta e Interpolação**
  - Formulário de requisição (URL, Headers, Params, Body, Auth).
  - Interpolação de variáveis `{{chave}}` e painel de resposta formatada.

- **Etapa 8: Módulo de Collections (Estilo Bruno), Importação e Sync OpenAPI**
  - **Aba Detalhada da Collection:** Implementação do layout de detalhamento ao clicar na coleção, contendo as abas superiores (`Overview`, `Headers`, `Vars`, `Auth`, `Script`, `Tests`, `Presets`, etc.) e o painel `Overview` estruturado com os cards de metadados (**Location**, **Version**, **Environments**, **Requests**, etc.) e bloco de **Documentation**.
  - **Parser de Importação:** Módulo desacoplado (SOLID) para importação de especificações web (ex: OpenAPI v3 / Swagger em JSON/YAML via URL ou arquivo local).
  - **Monitoramento e Update Remoto:** Armazenamento da URL de origem da spec e rotina de verificação de atualizações com botão manual de sincronização.
  - **Resolução de Conflitos (Diff Local vs Remoto):** Tabela/modal comparativo de rotas alteradas, adicionadas ou removidas para o usuário escolher se substitui, ignora ou mescla endpoints customizados localmente.

---

Inicie agora pela **Etapa 1**, apresentando a arquitetura de pastas, configurações de build (`package.json`, `tsconfig.json`) e a estrutura inicial com os contratos de interface.