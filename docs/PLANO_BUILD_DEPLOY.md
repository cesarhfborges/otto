# Plano — Build, versionamento e release (Linux + Windows)

## Objetivo

| Plataforma | Formato | Alvo do electron-builder |
| --- | --- | --- |
| Linux | AppImage | `AppImage` |
| Linux | Pacote Debian | `deb` |
| Windows | Instalador `.exe` | `nsis` |

Releases **automáticas** no GitHub, com a versão beta separada da versão final:

| Branch | Gera release? | Versão | Tipo no GitHub |
| --- | --- | --- | --- |
| `master` | Sim | `1.2.0` | Release (latest) |
| `beta` | Sim | `1.2.0-beta.3` | Pre-release |
| demais | Não | — | — |

## Dá para fazer tudo sem Windows?

**Sim.** O instalador do Windows pode ser gerado no Linux:

- O app não tem dependências nativas: o SQLite vem do `node:sqlite`, embutido no Electron, e as outras libs são JS puro.
- O electron-builder gera o instalador NSIS no Linux. Para gravar ícone e metadados no `.exe`, ele precisa do **Wine**; a imagem Docker `electronuserland/builder:wine` já o traz.
- O que **não** dá para fazer sem Windows:
  - **Testar** o instalador: use uma VM.
  - **Assinar** o `.exe`: exige um certificado pago. Sem ele, o SmartScreen mostra o aviso "Editor desconhecido" e o usuário clica em "Executar assim mesmo".

macOS fica fora por enquanto. Se entrar depois, basta um job `macos-latest` no mesmo workflow (sem precisar de um Mac).

---

## Versionamento

### Padrão: SemVer + pré-release

- Versão final: `MAIOR.MENOR.CORREÇÃO` → `1.2.0`
- Versão beta: `MAIOR.MENOR.CORREÇÃO-beta.N` → `1.2.0-beta.1`, `1.2.0-beta.2`...
- Enquanto o software não estiver estável, a versão final fica em `0.x.y` (ex.: `0.3.0`). A primeira versão estável será a `1.0.0`.

### A versão é calculada sozinha (Conventional Commits)

Ninguém edita a versão à mão. A ferramenta **semantic-release** lê as mensagens dos commits desde a última release e decide o próximo número:

| Mensagem do commit | Efeito |
| --- | --- |
| `fix: corrige salvamento da árvore` | correção → `0.3.0` → `0.3.1` |
| `feat: exportar coleção em ZIP` | recurso → `0.3.1` → `0.4.0` |
| `feat!: ...` ou `BREAKING CHANGE:` no corpo | quebra → `1.0.0` (em `0.x`, sobe o menor) |
| `chore:`, `docs:`, `refactor:`, `style:` | não gera release |

Ela também gera o **changelog** e as **notas da release** a partir desses commits.

> Dica: use **Squash and merge** nos PRs. Assim só o título do PR precisa seguir o padrão (`feat: ...`), e ele vira o commit.

### Deixando claro, para o usuário, que é beta

1. **No GitHub:** releases da `beta` são marcadas como *Pre-release*, com tag `v1.2.0-beta.N`. A página "Latest" sempre aponta para a versão final.
2. **Nos arquivos:** o nome inclui a versão, ex.: `Otto-1.2.0-beta.3-x86_64.AppImage`, `Otto-Setup-1.2.0-beta.3.exe`.
3. **Dentro do app:**
   - selo **"BETA"** na barra de título/rodapé e no "Sobre", exibido quando a versão contém `-beta`;
   - título da janela: `Otto 1.2.0-beta.3`.
   - A versão chega ao renderer pelo preload (`app.getVersion()`).
4. **Instalação lado a lado (opcional):** gerar a beta com outro `appId`/nome (`Otto Beta`, `dev.otto.app.beta`), para que a beta e a final convivam na mesma máquina sem compartilhar os dados. Recomendado. Faz-se por variável de ambiente no build da branch `beta`.

---

## Fluxo de branches

```
feature/x ──PR──▶ beta ──PR──▶ master
                   │              │
                   ▼              ▼
          v0.4.0-beta.1      v0.4.0
          (pre-release)      (release)
```

1. Crie a branch a partir da `master`: `git switch -c feat/minha-feature master`.
2. Desenvolva com commits `feat:` ou `fix:`. Nada é publicado.
3. Abra um PR para a **`beta`**. No merge, sai automaticamente a `0.4.0-beta.1` como pre-release.
4. Correções na beta (novos PRs para `beta`) geram `0.4.0-beta.2`, `-beta.3`...
5. Aprovado nos testes, abra o PR **`beta` → `master`**. No merge, sai a `0.4.0` final.
6. Depois da release final, a `beta` é atualizada com a `master` (merge `master` → `beta`, também automatizável no workflow) para seguir em sincronia.

> **Hotfix urgente:** branch a partir da `master`, PR direto para `master`, release `0.4.1`. Depois a `master` é levada de volta para a `beta`.

### Proteção das branches (configurar no GitHub)
- `master` e `beta`: exigir PR, sem push direto, exigir o check de build passando.

---

## Automação (GitHub Actions)

### `.github/workflows/ci.yml` — todo PR
- `npm ci` → `npm run typecheck` → `npm run build`.
- Não publica nada; só garante que o PR compila antes do merge.

### `.github/workflows/release.yml` — push em `master` ou `beta`
Disparado pelo merge do PR (`on: push: branches: [master, beta]`):

1. Checkout com histórico completo (`fetch-depth: 0`).
2. `npm ci`.
3. **semantic-release** calcula a versão. Se nenhum commit `feat`/`fix` entrou, o job termina sem release.
4. A versão calculada é escrita no `package.json` (só no runner, sem commit de volta).
5. `npm run build` + `electron-builder --linux --win` dentro do container `electronuserland/builder:wine`.
6. semantic-release cria a tag `vX.Y.Z[-beta.N]` e a Release no GitHub (pre-release se for `beta`), anexando:
   - `Otto-X.Y.Z-x86_64.AppImage`
   - `otto_X.Y.Z_amd64.deb`
   - `Otto-Setup-X.Y.Z.exe`
   - notas geradas a partir dos commits.

Usa o `GITHUB_TOKEN` padrão, com a permissão `contents: write`. Não é preciso nenhum segredo extra.

### Configuração do semantic-release (`.releaserc.json`)
```json
{
  "branches": ["master", { "name": "beta", "prerelease": true }],
  "plugins": [
    "@semantic-release/commit-analyzer",
    "@semantic-release/release-notes-generator",
    ["@semantic-release/exec", { "prepareCmd": "npm version ${nextRelease.version} --no-git-tag-version && npm run dist:release" }],
    ["@semantic-release/github", { "assets": [
      { "path": "release/*.AppImage" },
      { "path": "release/*.deb" },
      { "path": "release/*.exe" }
    ] }]
  ]
}
```

---

## Etapas de implementação

1. **package.json**
   - `artifactName` com a versão; opções de `deb` e `nsis` (atalhos, nome na desinstalação).
   - Script `dist:release` → `npm run build && electron-builder --linux --win --publish never`.
   - Dev deps: `semantic-release`, `@semantic-release/exec`.
   - Versão inicial: `0.1.0`, com tag `v0.1.0` criada na `master` como ponto de partida.
2. **Build local** (validação manual, uma vez):
   - Linux: `npm run dist:linux`; testar o AppImage e `sudo apt install ./release/*.deb`.
   - Windows via Docker:
     ```bash
     docker run --rm -v "$PWD":/project -w /project electronuserland/builder:wine \
       bash -c "npm ci && npm run dist:win"
     ```
   - Testar o `.exe` numa VM Windows.
3. **Selo BETA no app:** expor a versão no preload, com um `computed` `isBeta` e o selo no shell e no "Sobre".
4. **Variante beta lado a lado** (opcional): `appId`/`productName` diferentes quando o build for da branch `beta`.
5. **Workflows:** `ci.yml` e `release.yml` + `.releaserc.json`.
6. **GitHub:** criar a branch `beta` a partir da `master`; proteções de branch; permitir "Squash and merge".
7. **README:** seção "Como lançar uma versão" com o fluxo acima.

## Depois (opcional)
- Atualização automática com `electron-updater`: a beta recebe as betas e a final só as finais (canais `beta`/`latest`). Funciona com AppImage e NSIS; o `.deb` não.
- Assinatura de código no Windows para remover o aviso do SmartScreen.
- Build de macOS via runner `macos-latest`.
