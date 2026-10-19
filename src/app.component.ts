import { Component, inject } from '@angular/core';
import { RouterModule } from '@angular/router';
import { ElectronService } from './app/core/electron.service';
import { LayoutService } from './app/layout/service/layout.service';

@Component({
    selector: 'app-root',
    imports: [RouterModule],
    template: `<router-outlet></router-outlet>`
})
export class AppComponent {
    private readonly layoutService = inject(LayoutService);

    constructor() {
        inject(ElectronService).onMenuAction((action) => {
            switch (action.type) {
                case 'toggle-theme':
                    this.layoutService.layoutConfig.update((config) => ({ ...config, darkTheme: !config.darkTheme }));
                    break;
                default:
                    // new-request, new-collection, open-collection e save serão tratados na UI do cliente de API.
                    console.info('[otto] menu action', action);
            }
        });
    }
}
