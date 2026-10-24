import { Component } from '@angular/core';
import { Shell } from './app/shell/shell';

@Component({
    selector: 'app-root',
    imports: [Shell],
    template: `<app-shell />`
})
export class AppComponent {}
