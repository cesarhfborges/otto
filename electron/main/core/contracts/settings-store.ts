import type { OttoSettings, SettingsPatch } from '../../../shared/models';

/** Persistência das preferências do usuário. */
export interface ISettingsStore {
    get(): OttoSettings;
    /** Aplica um patch já validado e retorna as settings completas. */
    update(patch: SettingsPatch): OttoSettings;
}

/** Preferências com notificação de mudanças (consumido por tray, tema, executor HTTP e IPC). */
export interface ISettingsService extends ISettingsStore {
    /** Retorna a função para remover o listener. */
    onChange(listener: (settings: OttoSettings) => void): () => void;
}

export interface WindowBounds {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** Estado interno da janela (não exposto ao renderer). */
export interface IWindowStateStore {
    getBounds(): WindowBounds | undefined;
    setBounds(bounds: WindowBounds): void;
}
