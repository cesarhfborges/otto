// Inicia o Electron garantindo que ele não rode em modo Node.
// Terminais integrados do VS Code (e outros apps Electron) exportam ELECTRON_RUN_AS_NODE=1,
// o que faz `electron .` se comportar como `node` e quebrar o processo main.
import { spawn } from 'node:child_process';
import electronPath from 'electron';

const env = { ...process.env };

delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronPath, ['.', ...process.argv.slice(2)], { stdio: 'inherit', env });

child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 0)));

for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => child.kill(sig));
}
