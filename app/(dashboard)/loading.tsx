import { Skeleton } from "@/components/ui/skeleton";

/**
 * Esqueleto de carga de todo el dashboard.
 *
 * No está sólo para tapar el hueco: en Next las rutas dinámicas —y acá lo son
 * todas, por el `force-dynamic` de cada página— **no se prefetchean si no hay
 * un `loading` en el camino**. Sin este archivo, tocar una pestaña de la barra
 * del teléfono no disparaba nada hasta el toque, y recién ahí empezaba el
 * viaje entero: sesión, perfil, y las consultas de la pantalla. La pantalla
 * anterior se quedaba congelada, sin una sola señal de que algo estaba
 * pasando; es lo que se siente como que la app "no responde".
 *
 * Con el `loading` presente, el router se baja por adelantado el tramo que va
 * del layout hasta este límite, la pestaña nueva pinta al instante y los datos
 * entran por streaming cuando llegan.
 *
 * El esqueleto es deliberadamente genérico: no imita ninguna pantalla en
 * particular, porque acertarle a medias a la que viene se nota más que no
 * intentarlo. Son bloques del alto de una fila, que es lo que casi todas las
 * pantallas dibujan.
 */
export default function DashboardLoading() {
  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-3 sm:p-4 md:p-6">
      <Skeleton className="h-8 w-40 shrink-0" />
      <div className="flex min-h-0 flex-1 flex-col gap-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton
            key={i}
            className="h-14 w-full shrink-0"
            // Se va apagando hacia abajo: la última fila no compite con la
            // primera por la atención mientras no hay nada que leer.
            style={{ opacity: 1 - i * 0.1 }}
          />
        ))}
      </div>
    </div>
  );
}
