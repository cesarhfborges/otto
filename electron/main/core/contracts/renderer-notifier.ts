import type { IpcEventChannel, IpcEventContract } from '../../../shared/ipc';

/** Envia eventos do main para o renderer (implementado pela janela principal). */
export interface IRendererNotifier {
    notify<C extends IpcEventChannel>(channel: C, payload: IpcEventContract[C]): void;
}
