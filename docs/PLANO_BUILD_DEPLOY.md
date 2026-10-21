# Plano — Build e distribuição (Linux + Windows)

## Objetivo

| Plataforma | Formato | Alvo do electron-builder |
| --- | --- | --- |
| Linux | AppImage | `AppImage` |
| Linux | Pacote Debian | `deb` |
| Windows | Instalador `.exe` | `nsis` |

## Dá para fazer tudo sem Windows?

**Sim.** O instalador do Windows pode ser gerado no Linux:

- O app não tem dependências nativas: o SQLite vem do `node:sqlite`, embutido no Electron, e as outras libs são JS puro. Por isso não é preciso compilar nada para o Windows.
- O electron-builder gera o instalador NSIS no Linux. Para gravar ícone e metadados no `.exe`, ele precisa do **Wine** (ou de uma imagem Docker que já o tenha).
- O que **não** dá para fazer sem Windows:
  - **Testar** o instalador: use uma VM ou uma máquina com Windows.
  - **Assinar** o `.exe`: dá para fazer no Linux, mas exige um certificado pago. Sem assinatura, o Windows SmartScreen mostra um aviso ("Editor desconhecido") e o usuário clica em "Executar assim mesmo". Isso é aceitável no início.

## Situação atual

Boa parte já existe no `package.json`:

- `electron-builder` instalado, com seção `build` configurada.
- Alvos já declarados: `AppImage` e `deb` (linux) e `nsis` (win).
- Ícones em `build/icon.png` (512×512) e `build/icon.ico`.
- Scripts `dist:linux` e `dist:win`.

Falta: validar a geração de cada formato, garantir o Wine para o build de Windows, ajustar detalhes de empacotamento e automatizar a publicação.

## Etapas

### 1. Ajustes no `package.json`
- `artifactName` padronizado, ex.: `Otto-${version}-${arch}.${ext}`.
- `deb`: dependências mínimas e `synopsis`/`description`.
- `nsis`: atalho na área de trabalho/menu iniciar e `uninstallDisplayName`.
- Remover `mac` e `dist:mac` (fora do escopo) ou deixar como está.
- Script `dist:all` → `electron-builder --linux --win`.

### 2. Build local de Linux
- `npm run dist:linux` → `release/*.AppImage` e `release/*.deb`.
- Testar: executar o AppImage e instalar o `.deb` com `sudo apt install ./release/Otto-*.deb`.

### 3. Build local de Windows (no Linux)
Opção A (recomendada, nada instalado no sistema): Docker com a imagem oficial.
```bash
docker run --rm -v "$PWD":/project -w /project electronuserland/builder:wine \
  bash -c "npm ci && npm run dist:win"
```
Opção B: instalar `wine64` no sistema e rodar `npm run dist:win` direto.

- Testar o `.exe` numa VM Windows (instalar, abrir, desinstalar).

### 4. Automação com GitHub Actions (deploy)
Workflow `.github/workflows/release.yml`, disparado por tag `v*`:
- Um único job `ubuntu-latest` roda `npm ci`, `npm run build` e `electron-builder --linux --win --publish always`. O runner do Ubuntu tem Wine disponível; se faltar, usar o container `electronuserland/builder:wine`.
- `GH_TOKEN` (o `GITHUB_TOKEN` padrão) para publicar no **GitHub Releases**.
- Fluxo de release: `npm version patch` → `git push --follow-tags` → os artefatos aparecem na Release.

### 5. (Opcional, depois) Melhorias
- Atualização automática com `electron-updater` (funciona com AppImage e NSIS; `.deb` não).
- Assinatura de código no Windows para remover o aviso do SmartScreen.

## Entregáveis

1. `package.json` ajustado.
2. `.github/workflows/release.yml`.
3. Seção "Build e release" no `README.md`.
