export function requireElement<T extends HTMLElement>(id: string, elementType: { new (): T; prototype: T }): T {
  const element = document.getElementById(id);
  if (!(element instanceof elementType)) throw new Error(`Missing #${id} in index.html`);
  return element;
}

/** Writing identical text still invalidates layout, and UI updates run every frame. */
export function setText(element: HTMLElement, text: string): void {
  if (element.textContent !== text) element.textContent = text;
}
