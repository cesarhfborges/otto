// Calcula a próxima versão sem publicar nada (semantic-release em dry-run) e a grava
// em `version` no GITHUB_OUTPUT; fica vazia quando os commits não geram release.
import { appendFileSync } from 'node:fs';
import semanticRelease from 'semantic-release';

const result = await semanticRelease({ dryRun: true, ci: true });
const version = result ? result.nextRelease.version : '';

console.log(version ? `Next version: ${version}` : 'No release for these commits.');

if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\n`);
}
