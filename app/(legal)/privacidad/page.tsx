import type { Metadata } from "next";
import { CONTACTO_EMAIL, INSTAGRAM_HANDLE, ULTIMA_ACTUALIZACION } from "../datos";

export const metadata: Metadata = {
  title: "Política de privacidad — Zenna",
  description:
    "Qué datos personales trata Zenna, con qué finalidad, por cuánto tiempo y cómo ejercer tus derechos.",
};

export default function PrivacidadPage() {
  return (
    <article>
      <h1 className="font-display text-3xl font-semibold">
        Política de privacidad
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Última actualización: {ULTIMA_ACTUALIZACION}
      </p>

      <h2>Quiénes somos</h2>
      <p>
        Zenna es el sistema de gestión interno de la peluquería que opera la
        cuenta de Instagram {INSTAGRAM_HANDLE}. Lo usa el personal del salón para
        administrar turnos, fichas de clientas y las conversaciones que mantiene
        con ellas por WhatsApp e Instagram.
      </p>
      <p>
        No es una aplicación de uso público: no hay registro abierto ni cuentas
        para clientas. El único acceso es el del personal autorizado del salón.
      </p>

      <h2>Qué datos tratamos</h2>
      <p>
        Tratamos únicamente los datos necesarios para atender a quien se comunica
        con el salón o reserva un turno:
      </p>
      <ul>
        <li>
          <strong>Datos de contacto:</strong> nombre, número de teléfono y, en el
          caso de Instagram, el identificador interno de la conversación (IGSID),
          el nombre de usuario y la foto de perfil públicos.
        </li>
        <li>
          <strong>Mensajes:</strong> el contenido de las conversaciones
          mantenidas con el salón por WhatsApp o por mensajes directos de
          Instagram, incluidos los archivos adjuntos que se envíen (imágenes,
          audios, videos, documentos).
        </li>
        <li>
          <strong>Datos del servicio:</strong> turnos reservados, servicios
          realizados, profesional que atendió, importes y forma de pago.
        </li>
        <li>
          <strong>Notas internas:</strong> observaciones que el personal registra
          sobre preferencias o antecedentes del servicio (por ejemplo, fórmulas
          de color o alergias informadas por la clienta).
        </li>
      </ul>
      <p>
        No pedimos ni almacenamos datos de tarjetas de crédito, ni recolectamos
        información de navegación con fines publicitarios. No usamos cookies de
        seguimiento de terceros.
      </p>

      <h2>Para qué los usamos</h2>
      <ul>
        <li>Responder mensajes y coordinar turnos.</li>
        <li>Enviar recordatorios de turnos ya reservados.</li>
        <li>Llevar el historial de servicios de cada clienta.</li>
        <li>Administrar la caja y la facturación del salón.</li>
      </ul>
      <p>
        No vendemos, alquilamos ni cedemos datos personales a terceros con fines
        comerciales, ni los usamos para publicidad dirigida fuera de nuestros
        propios canales de atención.
      </p>

      <h2>Base para el tratamiento</h2>
      <p>
        Tratamos los datos con el consentimiento de la persona, que se manifiesta
        al escribirle al salón o al reservar un turno, y para poder ejecutar el
        servicio solicitado. Podés retirar ese consentimiento cuando quieras
        (ver <a href="/eliminacion-de-datos">eliminación de datos</a>).
      </p>

      <h2>Con quién se comparten</h2>
      <p>
        Los datos se alojan en servidores de proveedores que actúan como
        encargados del tratamiento y solo los procesan por nuestra cuenta:
      </p>
      <ul>
        <li>
          <strong>Supabase</strong> — base de datos y almacenamiento de archivos.
        </li>
        <li>
          <strong>Railway</strong> — infraestructura donde corre la aplicación.
        </li>
        <li>
          <strong>Meta Platforms</strong> — necesariamente interviene en la
          entrega de los mensajes de Instagram y WhatsApp, conforme a sus propias
          políticas.
        </li>
      </ul>
      <p>
        También podrían divulgarse si una autoridad competente lo requiere por
        una vía legal válida.
      </p>

      <h2>Cuánto tiempo los conservamos</h2>
      <p>
        Conservamos los datos mientras la persona siga siendo clienta del salón y
        durante los plazos que exija la normativa fiscal y comercial aplicable.
        Pasado ese período, o ante un pedido de eliminación, se borran conforme
        al procedimiento descripto en la página de{" "}
        <a href="/eliminacion-de-datos">eliminación de datos</a>.
      </p>

      <h2>Seguridad</h2>
      <p>
        El acceso al sistema está restringido al personal autorizado mediante
        usuario y contraseña. Las credenciales de las integraciones se guardan
        cifradas y con acceso restringido a nivel de base de datos, y nunca se
        exponen al navegador. La comunicación con el sistema viaja siempre por
        HTTPS.
      </p>

      <h2>Tus derechos</h2>
      <p>
        Podés solicitar en cualquier momento el acceso, la rectificación, la
        actualización o la supresión de tus datos personales, así como oponerte a
        recibir mensajes. Escribinos a{" "}
        <a href={`mailto:${CONTACTO_EMAIL}`}>{CONTACTO_EMAIL}</a> y respondemos
        dentro de los 10 días corridos.
      </p>
      <p>
        En Argentina, la Agencia de Acceso a la Información Pública es el órgano
        de control de la Ley 25.326 de Protección de los Datos Personales y tiene
        atribuciones para atender las denuncias que se presenten sobre el
        incumplimiento de las normas de protección de datos personales.
      </p>

      <h2>Cambios</h2>
      <p>
        Si modificamos esta política, actualizamos la fecha del encabezado. Los
        cambios rigen desde su publicación en esta página.
      </p>

      <h2>Contacto</h2>
      <p>
        Por cualquier consulta sobre esta política escribinos a{" "}
        <a href={`mailto:${CONTACTO_EMAIL}`}>{CONTACTO_EMAIL}</a> o por mensaje
        directo a {INSTAGRAM_HANDLE}.
      </p>
    </article>
  );
}
