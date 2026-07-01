// 제목표시줄(렌더러)에서 쓰는 창 제어 브리지.
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('meari', {
  getLogo: (): Promise<string> => ipcRenderer.invoke('meari:logo'),
  minimize: (): void => ipcRenderer.send('meari:win', 'minimize'),
  toggleMaximize: (): void => ipcRenderer.send('meari:win', 'maximize'),
  close: (): void => ipcRenderer.send('meari:win', 'close'),
  onMaximize: (cb: (maximized: boolean) => void): void => {
    ipcRenderer.on('meari:maximized', (_e, v) => cb(Boolean(v)));
  },
});
