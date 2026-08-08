/**
 * Aviso interno "abrí esta conversación", del toque en una notificación a la
 * bandeja.
 *
 * Va por un evento del `window` y no por props ni estado global porque los dos
 * extremos no se conocen: el emisor es el puente del service worker, montado
 * en el layout del dashboard, y el receptor es la bandeja, que puede estar
 * montada o no según en qué pantalla esté el usuario.
 */

const EVENT = "zenna:open-conversation";

export function emitOpenConversation(conversationId: string): void {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: conversationId }));
}

/** Devuelve la función para desuscribirse, lista para el cleanup del efecto. */
export function onOpenConversation(
  handler: (conversationId: string) => void,
): () => void {
  const listener = (event: Event) => {
    const id = (event as CustomEvent<string>).detail;
    if (typeof id === "string" && id) handler(id);
  };

  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
