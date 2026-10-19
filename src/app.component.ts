import { Component, DestroyRef, effect, inject } from '@angular/core';
import { Router, RouterModule } from '@angular/router';
import { MenuEventsGateway } from './app/core/ports';
import { ThemeService } from './app/core/theme/theme.service';
import { LayoutService } from './app/layout/service/layout.service';

@Component({
    selector: 'app-root',
    imports: [RouterModule],
    template: `<router-outlet></router-outlet>`
})
export class AppComponent {
    private readonly layoutService = inject(LayoutService);
    private readonly theme = inject(ThemeService);
    private readonly router = inject(Router);

    constructor() {
        // O LayoutService (template Sakai) apenas espelha o tema efetivo; a fonte da verdade é o ThemeService.
        effect(() => {
            const darkTheme = this.theme.isDark();

            this.layoutService.layoutConfig.update((config) => (config.darkTheme === darkTheme ? config : { ...config, darkTheme }));
        });

        const unsubscribe = inject(MenuEventsGateway).onMenuAction((action) => {
            switch (action.type) {
                case 'toggle-theme':
                    void this.theme.toggle();
                    break;
                case 'open-settings':
                    void this.router.navigate(['/settings']);
                    break;
                default:
                    // new-request, new-collection, open-collection e save serão tratados na UI do cliente de API.
                    console.info('[otto] menu action', action);
            }
        });

        inject(DestroyRef).onDestroy(unsubscribe);
    }
}
