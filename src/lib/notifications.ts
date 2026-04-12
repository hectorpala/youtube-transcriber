declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

export async function sendNotification(title: string, body: string) {
  if (typeof window !== "undefined" && window.__TAURI_INTERNALS__) {
    try {
      const { sendNotification: tauriNotify } = await import(
        "@tauri-apps/plugin-notification"
      );
      await tauriNotify({ title, body });
      return;
    } catch {
      // Fall through to web notification
    }
  }

  if (typeof Notification === "undefined") return;

  if (Notification.permission === "granted") {
    new Notification(title, { body });
  } else if (Notification.permission !== "denied") {
    const perm = await Notification.requestPermission();
    if (perm === "granted") {
      new Notification(title, { body });
    }
  }
}
