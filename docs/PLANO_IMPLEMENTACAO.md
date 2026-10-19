Atue como Engenheiro de Software Sênior especialista em Electron, Angular e Node.js.

Quero construir do zero um cliente de API desktop (alternativa offline ao Postman/Insomnia/Bruno) focado em controle de versão e privacidade total.

---

### Premissas e Arquitetura

1. **Stack Tecnológica:**
   - **Runtime:** Node.js v22 (LTS).
   - **Shell Desktop:** Electron (versão compatível com Node 22).
   - **Frontend:** Angular (Standalone Components, Signals, RxJS).
   - **Comunicação:** IPC seguro via `contextBridge` / `preload.js` (com `contextIsolation: true` e `nodeIntegration: false`).

2. **Paradigma Local-First:**
   - 100% offline: sem telemetria, sem autenticação externa, sem nuvem proprietária.
   - Os dados residem em uma pasta local do sistema de arquivos (compatível com Git).
   - Requisições HTTP disparadas exclusivamente pelo processo Node do Electron (evitando problemas de CORS no renderer).

---

### Funcionalidades Principais

- **Coleções no Filesystem:** Estrutura baseada em pastas físicas e arquivos de texto simples (JSON ou YAML) para representar requisições e pastas.
- **Requisições HTTP:** Suporte a métodos padrão (GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD).
- **Parâmetros e Configurações:** Edição de Headers, Query Params, Auth (Bearer, Basic, API Key) e Body (JSON, Text, Form-data).
- **Ambientes e Variáveis:** Arquivo local de `environments` com interpolação dinâmica no padrão `{{variavel}}`.
- **Painel de Resposta:** Status HTTP, tempo de resposta, tamanho do payload, visualizador com syntax highlighting (JSON formatado) e abas de Headers/Cookies.
- **Histórico e Abas:** Execuções locais salvas em arquivo/SQLite embutido e suporte a múltiplas abas abertas simultaneamente.

---

### Instruções de Execução Passo a Passo

Construa o projeto de forma modular e incremental. Forneça o código completo de cada arquivo sem omitir linhas críticas. Siga rigorosamente estas fases:

- **Etapa 1: Setup do Boilerplate**
  - Configuração do projeto integrando Electron + Angular + TypeScript.
  - Setup do `main.ts`, `preload.ts` e configuração de build/watch concorrente.

- **Etapa 2: Ponte IPC e Sistema de Arquivos (Local-First)**
  - IPCs para: abrir diálogo de seleção de pasta, ler/escrever arquivos de coleções e sincronizar árvores de diretórios.
  - Definição das interfaces TypeScript para requisições, pastas e ambientes.

- **Etapa 3: Motor de Requisições HTTP (Node 22)**
  - Implementação do disparador HTTP no processo principal usando `undici` ou o `fetch` nativo do Node 22.
  - Captura precisa de métricas: tempo de resolução, headers de resposta, cookies e body.

- **Etapa 4: Interface Angular (Layout Base e Árvore)**
  - Criação da barra lateral com visualização em árvore das pastas e requisições locais.
  - Sistema de abas para alternar entre requisições abertas.

- **Etapa 5: Editor de Requisição e Resposta**
  - Formulário para URL, método HTTP, abas de Headers, Params e Body.
  - Painel de resposta com visualização formatada do JSON retornado.

- **Etapa 6: Interpolação de Variáveis de Ambiente**
  - Leitura de arquivos de ambiente (`.env` ou `env.json`) na pasta raiz.
  - Parser/Regex para substituir tokens `{{chave}}` em URLs, Headers e Bodies antes do envio.

Inicie agora pela **Etapa 1**, apresentando a estrutura de pastas do projeto, os arquivos de configuração (`package.json`, `tsconfig.json`) e o setup inicial do Electron com Angular.