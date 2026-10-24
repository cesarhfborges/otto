# Plano de Implementação — Atualização Automática (GitHub Releases)

> Status: **implementado** (2026-10-23).
>
> Diferenças em relação ao plano abaixo:
> - **Canais isolados**: instalação beta só aceita versões `-beta` e instalação final só aceita versões finais (`UpdateService.onAvailable` descarta qualquer outra, além do filtro do electron-updater). O build beta publica `beta*.yml` (`-c.publish.channel=beta` em `scripts/dist-release.mjs`); o final publica `latest*.yml`. Não se usa `generateUpdatesFilesForAllChannels`.
> - `skippedVersion`/`remindAfter` ficam em `userData/update-prompts.json` (não são preferências editáveis); só `updates.autoCheck` e `updates.autoDownload` entraram em `OttoSettings`.
> - Assets da release: `latest*.yml`, `beta*.yml` e `*.blockmap` (o AppImage embute o blockmap; o `.exe` gera arquivo próprio).
> - "Check for Updates…" no menu Help e na bandeja dispara o evento `updates:open-dialog`; o renderer abre a janela já verificando.

## 1. Objetivo

1. Verificar novas versões publicadas em **GitHub Releases** (`cesarhfborges/otto`) na inicialização e periodicamente.
2. Mostrar um **indicador "Update available"** na `app-status-bar`.
3. Ao clicar no indicador, abrir a **janela de atualização** com as notas da versão e as ações: **Download**, **Install and restart**, **Skip this version**, **Remind me later** e **Never update automatically**.
4. Criar a seção **Updates** em Preferences (verificação automática, download automático, canal, "Check now").

## 2. Situação atual

| Ponto | Hoje | Impacto |
| --- | --- | --- |
| `package.json` → `build.publish` | `null` | O electron-builder não gera `latest.yml` / `latest-linux.yml`, que o updater precisa. |
| `.releaserc.json` → assets | `*.AppImage`, `*.deb`, `*.exe` | Faltam os `.yml` e os `.blockmap` (download diferencial). |
| `scripts/dist-release.mjs` | `--publish never` | Continua assim: quem sobe os arquivos é o semantic-release. |
| Beta | `appId` próprio (`dev.otto.app.beta`), versão `X.Y.Z-beta.N` | O build beta deve aceitar pre-releases; o final, não. |
| Alvos | AppImage, deb (Linux), NSIS (Windows), dmg (macOS, não publicado) | Nem todos suportam auto-update (§3). |
| IPC | Contratos tipados em `electron/shared/ipc.ts` + `electron/main/ipc/*.ipc.ts` + `preload.ts` | O updater segue o mesmo padrão. |
| Settings | Folhas chave/valor em SQLite (`core/validation/settings.ts`) | Novas chaves `updates.*`. |
| Preferences | `settings.page.ts` → `PreferencesSection` | Nova seção `updates`. |

## 3. Abordagem

Usar **`electron-updater`** (do próprio electron-builder) com o provider `github`.

| Formato | Auto-update | Comportamento |
| --- | --- | --- |
| **AppImage** | Sim | Baixa o novo AppImage e substitui o arquivo ao reiniciar. |
| **NSIS (Windows)** | Sim | Baixa o instalador (diferencial via `.blockmap`) e instala ao sair. Funciona sem assinatura (não definir `publisherName`). |
| **deb** | Não | Só **notifica**: o botão vira **"Open release page"** (abre a release no navegador) para instalar manualmente. |
| **dmg (macOS)** | Exige assinatura | Fora do escopo; tratar como "notificar apenas". |
| **Dev** (`!app.isPackaged`) | Desligado | Pode ser forçado com `dev-app-update.yml` + `forceDevUpdateConfig` para testes. |

A detecção do modo vem do main: `process.env.APPIMAGE` (AppImage), `process.platform === 'win32'` (NSIS), senão `notify-only`.

**Por que electron-updater e não uma implementação própria:** já resolve download com verificação SHA-512, diferencial, troca do AppImage e instalação NSIS, lendo exatamente os arquivos que o electron-builder gera.

## 4. Pipeline de release

1. `package.json`:
   - `electron-updater` em **`dependencies`** (roda no processo main).
   - `build.publish`: `{ "provider": "github", "owner": "cesarhfborges", "repo": "otto" }` — só para gerar os `.yml` e o `app-update.yml` embutido; o upload continua com `--publish never`.
   - `build.generateUpdatesFilesForAllChannels: true` — o build beta gera `beta.yml` / `beta-linux.yml`.
2. `.releaserc.json` → `@semantic-release/github.assets`: adicionar `release/*.yml` e `release/*.blockmap`.
3. Repositório **público**: o updater lê sem token. (Se ficar privado, exigiria token embutido — não recomendado.)
4. Canais:
   - Build final (`version` sem `-beta`): `allowPrerelease = false`, canal `latest`.
   - Build beta: `allowPrerelease = true`, `channel = 'beta'`. Como o beta tem outro `appId`, as duas instalações se atualizam de forma independente.
5. Validar: após uma release, os assets devem conter `latest.yml`, `latest-linux.yml`, `*.blockmap` e os instaladores.

## 5. Modelo e estado

`electron/shared/models/update.ts`:

```ts
export type UpdateMode = 'auto' | 'notify-only' | 'disabled';

export type UpdatePhase =
    | 'idle'
    | 'checking'
    | 'available'      // há versão nova (não pulada / não adiada)
    | 'not-available'
    | 'downloading'
    | 'downloaded'     // pronto para "Install and restart"
    | 'error';

export interface UpdateInfoView {
    version: string;
    releaseDate: string;
    releaseNotes: string;  // markdown/HTML da release do GitHub
    releaseUrl: string;    // https://github.com/cesarhfborges/otto/releases/tag/vX.Y.Z
}

export interface UpdateState {
    phase: UpdatePhase;
    mode: UpdateMode;
    currentVersion: string;
    info: UpdateInfoView | null;
    progress: { percent: number; transferred: number; total: number; bytesPerSecond: number } | null;
    error: string | null;
    lastCheckedAt: string | null;
}
```

Settings novas (`OttoSettings` + validação):

| Chave | Tipo | Padrão | Uso |
| --- | --- | --- | --- |
| `updates.autoCheck` | `boolean` | `true` | Verifica na inicialização e a cada 6 h. `false` = **"Never update"** (só manual via "Check now"). |
| `updates.autoDownload` | `boolean` | `false` | Baixa em segundo plano ao encontrar versão nova. |
| `updates.skippedVersion` | `string` | `''` | **Skip this version**: ignora essa versão; uma mais nova volta a avisar. |
| `updates.remindAfter` | `string` (ISO) | `''` | **Remind me later**: suprime o aviso até essa data (+24 h). |

Regra de exibição (no main): `available` só é anunciado se `version !== skippedVersion` e `now >= remindAfter`. "Check now" manual ignora as duas regras.

## 6. Processo main

`electron/main/services/updates/update.service.ts` (registrado em `container.ts`):

- Configura `autoUpdater`: `autoDownload = false`, `autoInstallOnAppQuit = true`, `allowPrerelease`/`channel` conforme §4, `logger` do app.
- Mantém `UpdateState` e emite `updates:state-changed` a cada evento (`checking-for-update`, `update-available`, `update-not-available`, `download-progress`, `update-downloaded`, `error`).
- `check(manual)`, `download()`, `install()` (`quitAndInstall` — passando pelo fluxo de saída que confirma rascunhos não salvos, ver `app:quit-requested`), `skip(version)`, `remindLater()`, `openReleasePage()` (`shell.openExternal`).
- Agendador: primeira verificação ~10 s após a janela abrir; depois a cada 6 h, se `updates.autoCheck`.
- Erros de rede são silenciosos na verificação automática (só registrados) e exibidos na manual.

IPC (`electron/shared/ipc.ts` + `electron/main/ipc/updates.ipc.ts` + `preload.ts`):

| Canal | Args | Resultado |
| --- | --- | --- |
| `updates:state` | — | `UpdateState` |
| `updates:check` | — | `UpdateState` |
| `updates:download` | — | `void` |
| `updates:install` | — | `void` |
| `updates:skip` | `version: string` | `void` |
| `updates:remind-later` | — | `void` |
| `updates:open-release` | — | `void` |
| evento `updates:state-changed` | `UpdateState` | — |

Menu nativo e tray: item **"Check for Updates…"** → `MenuAction` que abre a janela de update e dispara `check`.

## 7. Renderer

- **Porta/adaptador**: `UpdatesGateway` em `src/app/core/ports` + implementação Electron em `core/adapters/electron`, como os demais.
- **Estado**: `src/app/core/state/updates.state.ts` (signals): `state`, `available = computed(phase ∈ {available, downloading, downloaded})`, ações delegando ao gateway; escuta `updates:state-changed`.
- **Status bar** (`src/app/shell/status-bar.ts`): antes da versão, quando `available()`:
  - botão `otto-icon-button` com `pi pi-arrow-circle-down` + texto "Update available" (ou "Downloading 42%" / "Restart to update");
  - `aria-label` descritivo ("Update to version 0.2.0 available") e região `aria-live="polite"` para anunciar mudança de fase;
  - cor de destaque com contraste AA nos dois temas; abre o `UpdateDialog`.
- **Janela de update** `src/app/features/updates/update-dialog.ts` (`p-dialog` modal, aberto por `UpdateDialog` service como o `SettingsDialog`):
  - Cabeçalho: "Otto 0.2.0 is available — you have 0.1.0".
  - Notas da release (markdown renderizado/sanitizado, rolável).
  - `p-progressbar` durante o download (`aria-valuenow`).
  - Ações por fase/modo:

    | Fase | `auto` | `notify-only` (deb/mac) |
    | --- | --- | --- |
    | `available` | **Download** (primário), Remind me later, Skip this version | **Open release page** (primário), Remind me later, Skip this version |
    | `downloading` | Cancelar/fechar (continua em segundo plano) | — |
    | `downloaded` | **Install and restart** (primário), Install on next launch | — |
    | `error` | Retry, Open release page | Retry |

  - Rodapé: checkbox **"Don't check for updates automatically"** (= `updates.autoCheck = false`) e link para a seção de Preferences.
  - Foco inicial no botão primário; `Escape` só fecha o dialog, sem alterar preferências.
- **Preferences → Updates** (nova `PreferencesSection` `'updates'`, entre *Certificates* e *About*):
  - Versão atual e canal (Stable/Beta), "Last checked: …", botão **Check now**.
  - Toggles: *Check for updates automatically*, *Download updates automatically* (desabilitado em `notify-only`).
  - Se houver `skippedVersion`: "Version X is skipped" + **Clear**.

## 8. Fases

1. **Pipeline** (§4): publish config, assets `.yml`/`.blockmap`, gerar uma release beta e conferir os arquivos.
2. **Main**: modelo, settings, `UpdateService`, IPC, preload, item de menu/tray. Testar com `dev-app-update.yml` apontando para uma release real.
3. **Renderer**: gateway, `UpdatesState`, indicador na status bar.
4. **Janela de update**: dialog, notas, progresso, ações.
5. **Preferences → Updates**.
6. **Validação ponta a ponta**: instalar `v0.1.x` (AppImage e NSIS), publicar `v0.1.y`, verificar aviso → download → reinício na nova versão; deb mostra só "Open release page"; skip/remind/never respeitados após reiniciar; AXE limpo na status bar e no dialog.

## 9. Riscos e decisões em aberto

- **Windows sem assinatura**: o SmartScreen pode alertar no instalador baixado; o update funciona, mas o ideal é assinar no futuro.
- **AppImage em local sem permissão de escrita** (ex.: `/opt`): o updater falha; mostrar erro com "Open release page".
- **Notas da release**: o corpo vem do changelog do semantic-release (markdown) — precisa sanitização antes de renderizar.
- **Instalar com rascunhos não salvos**: `install()` passa pelo `quit-guard` existente.
- **Decisão**: "Never update" = desligar verificação automática (reversível em Preferences), não um bloqueio permanente. Confirmar.
- **Decisão**: intervalo de 6 h e "Remind me later" de 24 h. Confirmar ou oferecer opções (1 dia / 1 semana).
