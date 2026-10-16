/**
 * Órdenes de la lista de clientas. Los resuelve el servidor (`?orden=`): la
 * lista trae las primeras filas, y "las que vinieron hace poco" tienen que
 * salir de todas, no de las primeras por abecedario.
 */
export type ClientSort = "az" | "recientes" | "visitas" | "gasto";

export const CLIENT_SORTS: { value: ClientSort; label: string }[] = [
  { value: "az", label: "A–Z" },
  { value: "recientes", label: "Recientes" },
  { value: "visitas", label: "Frecuentes" },
  { value: "gasto", label: "Más gastaron" },
];

export function safeClientSort(value: string | undefined): ClientSort {
  return CLIENT_SORTS.some((s) => s.value === value)
    ? (value as ClientSort)
    : "az";
}
