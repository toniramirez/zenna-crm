import type { Metadata } from "next";
import { CONTACTO_EMAIL, INSTAGRAM_HANDLE, ULTIMA_ACTUALIZACION } from "../datos";

export const metadata: Metadata = {
  title: "Términos y condiciones — Zenna",
  description:
    "Condiciones de uso del sistema de gestión Zenna y de los canales de atención del salón.",
};

export default function TerminosPage() {
  return (
    <article>
      <h1 className="font-display text-3xl font-semibold">
        Términos y condiciones
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Última actualización: {ULTIMA_ACTUALIZACION}
      </p>

      <h2>Qué es Zenna</h2>
      <p>
        Zenna es el sistema de gestión interno de la peluquería que opera la
        cuenta de Instagram {INSTAGRAM_HANDLE}. Centraliza los turnos, las fichas
        de clientas, la caja y las conversaciones que el salón mantiene con ellas
        por WhatsApp y por mensajes directos de Instagram.
      </p>
      <p>
        Es una aplicación de un solo negocio: la desarrollamos para el salón que
        administramos nosotros mismos. No es un servicio ofrecido al público ni
        una plataforma contratable por otros negocios, y la única cuenta de
        Instagram conectada es la del propio salón. Estos términos alcanzan tanto
        al personal que la usa como a las personas que se comunican con el salón
        a través de los canales que administra.
      </p>
      <p>
        El uso de las integraciones con Instagram y WhatsApp se rige además por
        las condiciones de Meta Platforms. Nos comprometemos a usar los datos
        obtenidos de esas plataformas únicamente para la atención al cliente del
        salón, según se detalla en la{" "}
        <a href="/privacidad">política de privacidad</a>.
      </p>

      <h2>Acceso al sistema</h2>
      <p>
        El acceso está reservado al personal autorizado del salón, mediante
        credenciales personales e intransferibles. Cada persona es responsable de
        mantener su contraseña en secreto y de la actividad realizada con su
        cuenta. El salón puede revocar accesos en cualquier momento.
      </p>

      <h2>Uso de los canales de mensajería</h2>
      <p>
        Los mensajes que enviamos por WhatsApp e Instagram son de atención al
        cliente: respuestas a consultas, coordinación y recordatorios de turnos
        ya reservados. Podés pedir que dejemos de escribirte en cualquier
        momento, respondiendo en la misma conversación.
      </p>
      <p>
        El funcionamiento de estos canales depende de servicios de terceros
        (Meta Platforms) y de sus reglas, incluidas las ventanas de tiempo dentro
        de las cuales está permitido responder. No podemos garantizar la entrega
        de un mensaje cuando esos servicios no lo permiten o no están operativos.
      </p>

      <h2>Turnos</h2>
      <p>
        Un turno queda confirmado cuando el salón lo registra en el sistema. Las
        políticas de seña, cancelación y reprogramación son las que el salón
        informe al momento de reservar. Zenna es la herramienta donde esas
        políticas se registran, no una parte del acuerdo entre el salón y la
        clienta.
      </p>

      <h2>Datos personales</h2>
      <p>
        El tratamiento de datos personales se rige por nuestra{" "}
        <a href="/privacidad">política de privacidad</a>. El procedimiento para
        pedir su eliminación está descripto en la página de{" "}
        <a href="/eliminacion-de-datos">eliminación de datos</a>.
      </p>

      <h2>Disponibilidad</h2>
      <p>
        Procuramos que el sistema esté disponible de forma continua, pero puede
        haber interrupciones por mantenimiento, fallas de terceros o causas
        ajenas a nuestro control. No asumimos responsabilidad por perjuicios
        derivados de la falta de disponibilidad temporal del servicio.
      </p>

      <h2>Cambios</h2>
      <p>
        Podemos actualizar estos términos. La versión vigente es siempre la
        publicada en esta página, con la fecha indicada en el encabezado.
      </p>

      <h2>Contacto</h2>
      <p>
        Consultas sobre estos términos:{" "}
        <a href={`mailto:${CONTACTO_EMAIL}`}>{CONTACTO_EMAIL}</a>.
      </p>
    </article>
  );
}
