import type { Metadata } from "next";
import { CONTACTO_EMAIL, INSTAGRAM_HANDLE, ULTIMA_ACTUALIZACION } from "../datos";

export const metadata: Metadata = {
  title: "Eliminación de datos — Zenna",
  description:
    "Cómo pedir que borremos tus datos personales y tus conversaciones, y qué pasa después del pedido.",
};

export default function EliminacionDeDatosPage() {
  return (
    <article>
      <h1 className="font-display text-3xl font-semibold">
        Cómo eliminar tus datos
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Última actualización: {ULTIMA_ACTUALIZACION}
      </p>

      <p>
        Podés pedir que borremos toda la información que tengamos sobre vos. No
        hace falta dar explicaciones ni ser clienta activa del salón.
      </p>

      <h2>Cómo pedirlo</h2>
      <p>Elegí la vía que te resulte más cómoda:</p>
      <ul>
        <li>
          <strong>Por mail:</strong> escribí a{" "}
          <a href={`mailto:${CONTACTO_EMAIL}?subject=Eliminaci%C3%B3n%20de%20datos`}>
            {CONTACTO_EMAIL}
          </a>{" "}
          con el asunto <em>Eliminación de datos</em>.
        </li>
        <li>
          <strong>Por Instagram:</strong> mandanos un mensaje directo a{" "}
          {INSTAGRAM_HANDLE} pidiendo la eliminación.
        </li>
        <li>
          <strong>Por WhatsApp:</strong> respondé en la misma conversación que
          tengas con el salón pidiendo que borremos tus datos.
        </li>
      </ul>
      <p>
        Para poder identificar tu ficha necesitamos el <strong>nombre</strong> y
        el <strong>teléfono o usuario de Instagram</strong> con el que te
        comunicaste con nosotros. Si escribís desde la misma cuenta o número, con
        eso alcanza.
      </p>

      <h2>Qué borramos</h2>
      <ul>
        <li>Tu ficha de clienta: nombre, teléfono y datos de contacto.</li>
        <li>
          El historial completo de conversaciones por WhatsApp e Instagram, junto
          con los archivos adjuntos que se hayan intercambiado.
        </li>
        <li>Las notas internas asociadas a tu ficha.</li>
        <li>Tus turnos futuros, que quedan cancelados.</li>
      </ul>

      <h2>Qué se conserva y por qué</h2>
      <p>
        Los comprobantes de operaciones ya facturadas se conservan por el plazo
        que exige la normativa fiscal, porque no está en nuestras manos
        eliminarlos antes. En esos registros los datos quedan disociados de tu
        ficha: se mantiene el importe y la fecha de la operación, no tu
        información de contacto ni tus conversaciones.
      </p>

      <h2>En cuánto tiempo</h2>
      <p>
        Confirmamos la recepción del pedido dentro de las 72 horas y completamos
        la eliminación en un plazo máximo de 30 días corridos. Te avisamos por la
        misma vía por la que nos escribiste cuando esté hecho.
      </p>

      <h2>Revocar el acceso desde Instagram</h2>
      <p>
        Si además querés cortar el vínculo del lado de Meta, podés hacerlo desde
        tu propia cuenta de Instagram, en{" "}
        <em>Configuración → Aplicaciones y sitios web</em>, quitando el acceso a
        la aplicación. Eso impide nuevos intercambios de datos, pero no borra por
        sí solo lo que ya tengamos guardado: para eso hace falta el pedido
        descripto arriba.
      </p>

      <h2>Consultas</h2>
      <p>
        Si tenés dudas sobre el estado de tu pedido, escribinos a{" "}
        <a href={`mailto:${CONTACTO_EMAIL}`}>{CONTACTO_EMAIL}</a>.
      </p>
    </article>
  );
}
