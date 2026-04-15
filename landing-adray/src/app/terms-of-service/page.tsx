import Container from "@/components/ui/Container";

export const metadata = {
    title: "Terms of Service",
};

export default function TermsOfServicePage() {
    return (
        <section className="pt-32 pb-24">
            <Container>
                <h1 className="t-h2 text-white-95 mb-4">
                    Condiciones del Servicio
                </h1>
                <p className="t-p text-white-80 mb-8">
                    Última actualización: 31 de marzo de 2026
                </p>

                <div className="w-full overflow-hidden rounded-2xl border border-white/10 bg-black/20 p-6 md:p-10 space-y-8 text-white-90">
                    {/* ── Aceptación ── */}
                    <div className="space-y-4">
                        <h2 className="t-h4 text-white-95">
                            Aceptación de Nuestras Condiciones Legales
                        </h2>
                        <p className="t-p text-white-80">
                            Somos Adray, Inc. (&quot;Empresa,&quot;
                            &quot;nosotros,&quot; &quot;nos,&quot;
                            &quot;nuestro/a&quot;), empresa registrada en
                            Delaware, United States en 1111B S Governors Avenue
                            STE 53849, Dover, DE 19904. Nuestro número de IVA es
                            41-4858760.
                        </p>
                        <p className="t-p text-white-80">
                            Operamos el sitio web{" "}
                            <a
                                href="http://www.adray.ai"
                                className="underline"
                                target="_blank"
                                rel="noreferrer"
                            >
                                http://www.adray.ai
                            </a>{" "}
                            (el &quot;Página web&quot;), la aplicación móvil
                            Adray (el &quot;Aplicación&quot;) así como cualquier
                            otro producto o servicio relacionado que haga
                            referencia o enlace a estas condiciones legales (las
                            &quot;Menciones legales&quot;) (colectivamente, el
                            &quot;Servicios&quot;).
                        </p>
                        <p className="t-p text-white-80">
                            <strong>Acerca de Adray</strong> — Adray es una
                            plataforma de infraestructura de datos de marketing
                            basada en IA diseñada para empresas de comercio
                            electrónico. Conecta y normaliza datos procedentes de
                            plataformas publicitarias (Meta, Google Ads, TikTok),
                            plataformas de comercio electrónico (Shopify,
                            WooCommerce) y herramientas de análisis (Google
                            Analytics 4), ofreciendo una visión unificada y
                            conciliada del rendimiento de marketing a los
                            sistemas de IA y las herramientas de inteligencia
                            empresarial. Adray actúa como una capa de datos
                            centralizada entre la pila de marketing de un
                            comerciante y los flujos de trabajo basados en IA, lo
                            que permite una atribución precisa, la generación de
                            informes multicanal y la toma de decisiones basada en
                            datos sin necesidad de consolidar los datos
                            manualmente. La plataforma está diseñada para
                            profesionales del marketing nativos de la IA que
                            confían en herramientas como Claude y ChatGPT para
                            analizar el rendimiento, generar insights y
                            automatizar la generación de informes.
                        </p>
                        <p className="t-p text-white-80">
                            Puede ponerse en contacto con nosotros por teléfono
                            al +16194968692, correo electrónico{" "}
                            <a
                                href="mailto:contact@adray.ai"
                                className="underline"
                            >
                                contact@adray.ai
                            </a>
                            , o por correo a 1111B S Governors Avenue STE 53849,
                            Dover, DE 19904, United States.
                        </p>
                        <p className="t-p text-white-80">
                            Las presentes Condiciones Legales constituyen un
                            acuerdo jurídicamente vinculante celebrado entre
                            usted, ya sea personalmente o en nombre de una
                            entidad (&quot;usted&quot;), y Adray, Inc., relativas
                            a su acceso y uso de los Servicios. Usted acepta que,
                            al acceder a los Servicios, ha leído, comprendido y
                            aceptado quedar vinculado por todas estas Condiciones
                            Legales. SI NO ESTÁ DE ACUERDO CON TODAS ESTAS
                            CONDICIONES LEGALES, SE LE PROHÍBE EXPRESAMENTE EL
                            USO DE LOS SERVICIOS Y DEBE DEJAR DE UTILIZARLOS
                            INMEDIATAMENTE.
                        </p>
                        <p className="t-p text-white-80">
                            Le avisaremos con antelación de cualquier cambio
                            programado en los Servicios que esté utilizando. Las
                            Condiciones legales modificadas entrarán en vigor en
                            el momento de su publicación o notificación mediante{" "}
                            <a
                                href="mailto:contact@adray.ai"
                                className="underline"
                            >
                                contact@adray.ai
                            </a>
                            , como se indica en el mensaje de correo electrónico.
                            Al continuar utilizando los Servicios después de la
                            fecha de entrada en vigor de cualquier cambio, usted
                            acepta quedar vinculado por los términos modificados.
                        </p>
                        <p className="t-p text-white-80">
                            Los Servicios están destinados a usuarios mayores de
                            18 años. Las personas menores de 18 años no están
                            autorizadas a utilizar o registrarse en los Servicios.
                        </p>
                    </div>

                    {/* ── Índice ── */}
                    <div className="space-y-3">
                        <h2 className="t-h4 text-white-95">Índice</h2>
                        <ol className="list-decimal pl-5 space-y-1 t-p text-white-80">
                            <li>Nuestros Servicios</li>
                            <li>Derechos de Propiedad Intelectual</li>
                            <li>Representaciones del Usuario</li>
                            <li>Registro de Usuarios</li>
                            <li>Compras y Pagos</li>
                            <li>Suscripciones</li>
                            <li>Software</li>
                            <li>Actividades Prohibidas</li>
                            <li>Contribuciones Generadas por los Usuarios</li>
                            <li>Contribución — Licencia</li>
                            <li>Aplicación Móvil — Licencia</li>
                            <li>Medios de Comunicación Social</li>
                            <li>Sitios Web y Contenidos de Terceros</li>
                            <li>Gestión de Servicios</li>
                            <li>Política de Privacidad</li>
                            <li>Duración y Rescisión</li>
                            <li>Modificaciones e Interrupciones</li>
                            <li>Derecho Aplicable</li>
                            <li>Resolución de Conflictos</li>
                            <li>Correcciones</li>
                            <li>Aviso Legal</li>
                            <li>Limitaciones de Responsabilidad</li>
                            <li>Indemnización</li>
                            <li>Datos de Usuario</li>
                            <li>
                                Comunicaciones, Transacciones y Firmas
                                Electrónicas
                            </li>
                            <li>Usuarios y Residentes de California</li>
                            <li>Varios</li>
                            <li>
                                Anexo de Cumplimiento: Disposiciones
                                Suplementarias
                            </li>
                            <li>Contacto</li>
                        </ol>
                    </div>

                    {/* ── 1. Nuestros Servicios ── */}
                    <div className="space-y-4">
                        <h2 className="t-h4 text-white-95">
                            1. Nuestros Servicios
                        </h2>
                        <p className="t-p text-white-80">
                            La información proporcionada al utilizar los Servicios
                            no está destinada a ser distribuida ni utilizada por
                            ninguna persona o entidad en ninguna jurisdicción o
                            país en el que dicha distribución o uso sea contrario
                            a la ley o a la normativa o que nos someta a algún
                            requisito de registro en dicha jurisdicción o país.
                            Por consiguiente, las personas que decidan acceder a
                            los Servicios desde otros lugares lo harán por
                            iniciativa propia y serán las únicas responsables del
                            cumplimiento de la legislación local, en la medida en
                            que ésta sea aplicable.
                        </p>
                        <p className="t-p text-white-80">
                            Los Servicios no están adaptados para cumplir la
                            normativa específica del sector (Health Insurance
                            Portability and Accountability Act (HIPAA), Federal
                            Information Security Management Act (FISMA), etc.),
                            por lo que si sus interacciones estuvieran sujetas a
                            dichas leyes, no podrá utilizar los Servicios. No
                            podrá utilizar los Servicios de forma que infrinja la
                            Ley Gramm-Leach-Bliley (GLBA).
                        </p>
                    </div>

                    {/* ── 2. Derechos de Propiedad Intelectual ── */}
                    <div className="space-y-4">
                        <h2 className="t-h4 text-white-95">
                            2. Derechos de Propiedad Intelectual
                        </h2>
                        <h3 className="t-p font-semibold text-white-90">
                            Nuestra propiedad intelectual
                        </h3>
                        <p className="t-p text-white-80">
                            Somos el propietario o el licenciatario de todos los
                            derechos de propiedad intelectual de nuestros
                            Servicios, incluido todo el código fuente, bases de
                            datos, funcionalidad, software, diseños de sitios web,
                            audio, vídeo, texto, fotografías y gráficos de los
                            Servicios (colectivamente, el
                            &quot;Contenido&quot;), así como las marcas
                            comerciales, las marcas de servicio y los logotipos
                            que contiene (el &quot;Marcas&quot;).
                        </p>
                        <p className="t-p text-white-80">
                            Nuestro Contenido y Marcas están protegidos por las
                            leyes de derechos de autor y marcas registradas (y
                            otros derechos de propiedad intelectual y leyes de
                            competencia desleal) y tratados en Estados Unidos y en
                            todo el mundo.
                        </p>
                        <p className="t-p text-white-80">
                            El Contenido y las Marcas se proporcionan en o a
                            través de los Servicios &quot;TAL CUAL&quot; para su
                            uso personal, no comercial o fines empresariales
                            internos.
                        </p>
                        <h3 className="t-p font-semibold text-white-90">
                            Su uso de nuestros Servicios
                        </h3>
                        <p className="t-p text-white-80">
                            Sujeto al cumplimiento por su parte de las presentes
                            Condiciones Legales, incluido el apartado
                            &quot;Actividades Prohibidas&quot;, le concedemos un
                            derecho no exclusivo, intransferible, revocable
                            licencia a: acceder a los Servicios; y descargar o
                            imprimir una copia de cualquier parte del Contenido al
                            que haya accedido correctamente, únicamente para su
                            uso personal, no comercial o fines empresariales
                            internos.
                        </p>
                        <p className="t-p text-white-80">
                            Salvo lo dispuesto en esta sección o en cualquier otra
                            parte de nuestras Condiciones Legales, ninguna parte
                            de los Servicios ni ningún Contenido o Marca podrán
                            ser copiados, reproducidos, agregados, republicados,
                            cargados, enviados, mostrados públicamente,
                            codificados, traducirse, transmitirse, distribuirse,
                            venderse, licenciarse o explotarse de otro modo con
                            fines comerciales, sin nuestro permiso expreso previo
                            por escrito.
                        </p>
                        <p className="t-p text-white-80">
                            Si desea hacer un uso de los Servicios, Contenidos o
                            Marcas distinto del establecido en esta sección,
                            dirija su solicitud a:{" "}
                            <a
                                href="mailto:contact@adray.ai"
                                className="underline"
                            >
                                contact@adray.ai
                            </a>
                            . Nos reservamos todos los derechos no concedidos
                            expresamente a usted sobre los Servicios, el
                            Contenido y las Marcas.
                        </p>
                        <h3 className="t-p font-semibold text-white-90">
                            Sus propuestas y contribuciones
                        </h3>
                        <p className="t-p text-white-80">
                            <strong>Presentaciones:</strong> Al enviarnos
                            directamente cualquier pregunta, comentario,
                            sugerencia, idea, opinión u otra información sobre los
                            Servicios (&quot;Presentaciones&quot;), usted acepta
                            cedernos todos los derechos de propiedad intelectual
                            sobre dicha Presentación. Usted acepta que seremos
                            propietarios de este Envío y tendremos derecho a su
                            uso y difusión sin restricciones para cualquier fin
                            lícito, comercial o de otro tipo, sin reconocimiento
                            o compensación para usted.
                        </p>
                        <p className="t-p text-white-80">
                            <strong>Contribuciones:</strong> Los Servicios pueden
                            invitarle a chatear, contribuir o participar en blogs,
                            tablones de mensajes, foros en línea y otras
                            funcionalidades durante las cuales puede crear,
                            enviar, publicar, mostrar, transmitir, publicar,
                            distribuir o difundir contenidos y materiales
                            (&quot;Contribuciones&quot;). Toda Presentación que se
                            difunda públicamente se considerará también una
                            Contribución.
                        </p>
                        <p className="t-p text-white-80">
                            Al publicar Contribuciones, nos concede una licencia
                            ilimitada, irrevocable, perpetua, no exclusiva,
                            transferible, libre de regalías, totalmente pagada, en
                            todo el mundo, para utilizar, copiar, reproducir,
                            distribuir, vender, publicar, difundir, almacenar,
                            ejecutar públicamente, mostrar públicamente,
                            reformatear, traducir, extraer y explotar sus
                            Contribuciones para cualquier propósito, comercial,
                            publicitario o de otro tipo.
                        </p>
                    </div>

                    {/* ── 3. Representaciones del Usuario ── */}
                    <div className="space-y-4">
                        <h2 className="t-h4 text-white-95">
                            3. Representaciones del Usuario
                        </h2>
                        <p className="t-p text-white-80">
                            Al utilizar los Servicios, usted declara y garantiza
                            que: (1) toda la información de registro que envíe
                            será verdadera, exacta, actual y completa; (2)
                            mantendrá la exactitud de dicha información; (3) tiene
                            capacidad legal y acepta cumplir estas Condiciones
                            Legales; (4) no es menor de edad en su jurisdicción;
                            (5) no accederá a los Servicios a través de medios
                            automatizados o no humanos; (6) no utilizará los
                            Servicios para ningún fin ilegal; y (7) su uso de los
                            Servicios no infringirá ninguna ley o normativa
                            aplicable.
                        </p>
                        <p className="t-p text-white-80">
                            Si proporciona información falsa, inexacta, no
                            actualizada o incompleta, tenemos derecho a suspender
                            o cancelar su cuenta y rechazar cualquier uso actual o
                            futuro de los Servicios.
                        </p>
                    </div>

                    {/* ── 4. Registro de Usuarios ── */}
                    <div className="space-y-4">
                        <h2 className="t-h4 text-white-95">
                            4. Registro de Usuarios
                        </h2>
                        <p className="t-p text-white-80">
                            Es posible que tenga que registrarse para utilizar los
                            Servicios. Usted se compromete a mantener la
                            confidencialidad de su contraseña y será responsable
                            de todo uso que se haga de su cuenta y contraseña. Nos
                            reservamos el derecho a eliminar, reclamar o cambiar
                            un nombre de usuario que usted seleccione si
                            determinamos, a nuestra entera discreción, que dicho
                            nombre de usuario es inapropiado, obsceno o
                            censurable.
                        </p>
                    </div>

                    {/* ── 5. Compras y Pagos ── */}
                    <div className="space-y-4">
                        <h2 className="t-h4 text-white-95">
                            5. Compras y Pagos
                        </h2>
                        <p className="t-p text-white-80">
                            Aceptamos las siguientes formas de pago: Visa,
                            Mastercard, American Express, Discover y PayPal.
                        </p>
                        <p className="t-p text-white-80">
                            Usted se compromete a proporcionar información actual,
                            completa y precisa sobre la compra y la cuenta para
                            todas las compras realizadas a través de los
                            Servicios. El impuesto sobre las ventas se añadirá al
                            precio de las compras según consideremos necesario.
                            Podemos modificar los precios en cualquier momento.
                            Todos los pagos serán en dólares estadounidenses.
                        </p>
                        <p className="t-p text-white-80">
                            Nos reservamos el derecho a rechazar cualquier pedido
                            realizado a través de los Servicios. Podemos, a
                            nuestra entera discreción, limitar o cancelar las
                            cantidades compradas por persona, por hogar o por
                            pedido.
                        </p>
                    </div>

                    {/* ── 6. Suscripciones ── */}
                    <div className="space-y-4">
                        <h2 className="t-h4 text-white-95">6. Suscripciones</h2>
                        <p className="t-p text-white-80">
                            <strong>Facturación y renovación:</strong> Su
                            suscripción continuará y se renovará automáticamente a
                            menos que sea cancelada. Usted da su consentimiento
                            para que realicemos cargos recurrentes en su método de
                            pago sin requerir su aprobación previa para cada
                            cargo recurrente.
                        </p>
                        <p className="t-p text-white-80">
                            <strong>Anulación:</strong> Puede cancelar su
                            suscripción en cualquier momento accediendo a su
                            cuenta. La cancelación surtirá efecto al final del
                            periodo de pago en curso. Si tiene alguna pregunta,
                            envíenos un correo electrónico a{" "}
                            <a
                                href="mailto:contact@adray.ai"
                                className="underline"
                            >
                                contact@adray.ai
                            </a>
                            .
                        </p>
                        <p className="t-p text-white-80">
                            <strong>Cambios en las tasas:</strong> Podemos, de vez
                            en cuando, hacer cambios en la cuota de suscripción y
                            le comunicaremos cualquier cambio de precio de
                            conformidad con la legislación aplicable.
                        </p>
                    </div>

                    {/* ── 7. Software ── */}
                    <div className="space-y-4">
                        <h2 className="t-h4 text-white-95">7. Software</h2>
                        <p className="t-p text-white-80">
                            Podemos incluir software para su uso en relación con
                            nuestros Servicios. Si dicho software va acompañado de
                            un acuerdo de licencia de usuario final
                            (&quot;CLUF&quot;), los términos del CLUF regirán su
                            uso. Si no va acompañado de un CLUF, le concedemos un
                            derecho de uso no exclusivo, revocable, personal e
                            intransferible. Cualquier software y documentación
                            relacionada se proporciona &quot;TAL CUAL&quot; sin
                            garantía de ningún tipo.
                        </p>
                    </div>

                    {/* ── 8. Actividades Prohibidas ── */}
                    <div className="space-y-4">
                        <h2 className="t-h4 text-white-95">
                            8. Actividades Prohibidas
                        </h2>
                        <p className="t-p text-white-80">
                            No podrá acceder a los Servicios ni utilizarlos para
                            fines distintos de aquellos para los que los ponemos a
                            su disposición. Como usuario de los Servicios, usted
                            se compromete a no:
                        </p>
                        <ul className="list-disc pl-5 space-y-2 t-p text-white-80">
                            <li>
                                Recuperar sistemáticamente datos u otros
                                contenidos de los Servicios para crear
                                colecciones, compilaciones, bases de datos o
                                directorios sin nuestro permiso por escrito.
                            </li>
                            <li>
                                Engañarnos, defraudarnos o engañarnos a nosotros
                                y a otros usuarios, especialmente en cualquier
                                intento de obtener información confidencial de la
                                cuenta.
                            </li>
                            <li>
                                Eludir, desactivar o interferir de cualquier otro
                                modo con las funciones de seguridad de los
                                Servicios.
                            </li>
                            <li>
                                Desprestigiar, empañar o perjudicar de cualquier
                                otro modo a nosotros y/o a los Servicios.
                            </li>
                            <li>
                                Utilizar cualquier información obtenida de los
                                Servicios para acosar, abusar o dañar a otra
                                persona.
                            </li>
                            <li>
                                Hacer un uso indebido de nuestros servicios de
                                asistencia o presentar informes falsos.
                            </li>
                            <li>
                                Utilizar los Servicios de forma contraria a las
                                leyes o reglamentos aplicables.
                            </li>
                            <li>
                                Cargar o transmitir virus, troyanos u otro
                                material que interfiera con los Servicios.
                            </li>
                            <li>
                                Participar en cualquier uso automatizado del
                                sistema, incluido el uso de bots, scripts o
                                herramientas de minería de datos.
                            </li>
                            <li>
                                Intentar suplantar a otro usuario o persona.
                            </li>
                            <li>
                                Interferir, interrumpir o crear una carga indebida
                                en los Servicios.
                            </li>
                            <li>
                                Copiar o adaptar el software de los Servicios,
                                incluidos Flash, PHP, HTML, JavaScript u otros
                                códigos.
                            </li>
                            <li>
                                Descifrar, descompilar, desensamblar o aplicar
                                ingeniería inversa a cualquiera de los programas
                                informáticos de los Servicios, salvo en la medida
                                en que lo permita la legislación aplicable.
                            </li>
                            <li>
                                Vender o transferir de cualquier otro modo su
                                perfil.
                            </li>
                            <li>
                                Utilizar los Servicios para anunciar u ofrecer la
                                venta de bienes y servicios.
                            </li>
                        </ul>
                    </div>

                    {/* ── 9. Contribuciones Generadas por los Usuarios ── */}
                    <div className="space-y-4">
                        <h2 className="t-h4 text-white-95">
                            9. Contribuciones Generadas por los Usuarios
                        </h2>
                        <p className="t-p text-white-80">
                            Los Servicios pueden invitarle a chatear, contribuir o
                            participar en blogs, tablones de mensajes, foros en
                            línea y otras funcionalidades, y pueden ofrecerle la
                            oportunidad de crear, enviar, publicar, mostrar,
                            transmitir, ejecutar, publicar, distribuir o difundir
                            contenidos y materiales (&quot;Contribuciones&quot;).
                            Las contribuciones pueden ser vistas por otros
                            usuarios de los Servicios y a través de sitios web de
                            terceros. Por lo tanto, las contribuciones que usted
                            transmita pueden ser tratadas como no confidenciales y
                            sin derechos de propiedad.
                        </p>
                        <p className="t-p text-white-80">
                            Al crear o poner a disposición cualquier Contribución,
                            usted declara y garantiza que: sus Contribuciones no
                            infringen derechos de propiedad intelectual de
                            terceros; usted es el creador y propietario o dispone
                            de las licencias necesarias; sus Contribuciones no son
                            falsas, inexactas o engañosas; no son publicidad no
                            solicitada ni spam; no son obscenas, lascivas,
                            violentas ni acosadoras; y no infringen ninguna ley o
                            normativa aplicable.
                        </p>
                    </div>

                    {/* ── 10. Contribución Licencia ── */}
                    <div className="space-y-4">
                        <h2 className="t-h4 text-white-95">
                            10. Contribución — Licencia
                        </h2>
                        <p className="t-p text-white-80">
                            Al publicar sus Contribuciones en cualquier parte de
                            los Servicios, usted nos concede automáticamente una
                            licencia ilimitada, irrevocable, perpetua, no
                            exclusiva, transferible, libre de derechos de autor,
                            totalmente pagada, en todo el mundo, para alojar,
                            utilizar, copiar, reproducir, revelar, vender,
                            publicar, difundir, almacenar, ejecutar públicamente,
                            mostrar públicamente, reformatear, traducir,
                            transmitir, extraer y distribuir dichas
                            Contribuciones para cualquier propósito.
                        </p>
                        <p className="t-p text-white-80">
                            No hacemos valer ninguna propiedad sobre sus
                            Contribuciones. Usted conserva la plena propiedad de
                            todas sus Contribuciones y de cualquier derecho de
                            propiedad intelectual asociado. No somos responsables
                            de ninguna declaración o representación en sus
                            Contribuciones.
                        </p>
                    </div>

                    {/* ── 11. Aplicación Móvil Licencia ── */}
                    <div className="space-y-4">
                        <h2 className="t-h4 text-white-95">
                            11. Aplicación Móvil — Licencia
                        </h2>
                        <p className="t-p text-white-80">
                            Si accede a los Servicios a través de la App, le
                            concedemos un derecho revocable, no exclusivo,
                            intransferible y limitado a instalar y utilizar la App
                            en dispositivos electrónicos inalámbricos de su
                            propiedad o bajo su control, estrictamente de acuerdo
                            con los términos y condiciones de esta licencia.
                        </p>
                        <p className="t-p text-white-80">
                            <strong>Dispositivos Apple y Android:</strong> La
                            licencia concedida para nuestra App se limita a
                            utilizarla en un dispositivo que utilice los sistemas
                            operativos Apple iOS o Android, según proceda, y de
                            conformidad con las normas de uso establecidas en las
                            condiciones de servicio del distribuidor de la
                            aplicación correspondiente.
                        </p>
                    </div>

                    {/* ── 12. Medios de Comunicación Social ── */}
                    <div className="space-y-4">
                        <h2 className="t-h4 text-white-95">
                            12. Medios de Comunicación Social
                        </h2>
                        <p className="t-p text-white-80">
                            Como parte de la funcionalidad de los Servicios, usted
                            puede vincular su cuenta con cuentas en línea que
                            tenga con terceros proveedores de servicios (cada una
                            de dichas cuentas, una &quot;Cuenta de
                            terceros&quot;). Usted declara y garantiza que tiene
                            derecho a revelar los datos de acceso de su Cuenta de
                            terceros y/o permitirnos acceder a ella, sin
                            incumplimiento por su parte de ninguno de los términos
                            aplicables.
                        </p>
                        <p className="t-p text-white-80">
                            TENGA EN CUENTA QUE SU RELACIÓN CON LOS TERCEROS
                            PROVEEDORES DE SERVICIOS SE RIGE EXCLUSIVAMENTE POR
                            SU(S) ACUERDO(S) CON DICHOS TERCEROS PROVEEDORES.
                        </p>
                    </div>

                    {/* ── 13. Sitios Web y Contenidos de Terceros ── */}
                    <div className="space-y-4">
                        <h2 className="t-h4 text-white-95">
                            13. Sitios Web y Contenidos de Terceros
                        </h2>
                        <p className="t-p text-white-80">
                            Los Servicios pueden contener enlaces a otros sitios
                            web (&quot;Sitios web de terceros&quot;) así como
                            contenidos procedentes de terceros (&quot;Contenidos
                            de terceros&quot;). No investigamos, supervisamos ni
                            comprobamos la exactitud de dichos contenidos. Si
                            decide abandonar los Servicios y acceder a Sitios Web
                            de terceros, lo hace por su cuenta y riesgo, y debe
                            ser consciente de que estas Condiciones Legales ya no
                            rigen.
                        </p>
                    </div>

                    {/* ── 14. Gestión de Servicios ── */}
                    <div className="space-y-4">
                        <h2 className="t-h4 text-white-95">
                            14. Gestión de Servicios
                        </h2>
                        <p className="t-p text-white-80">
                            Nos reservamos el derecho, pero no la obligación, de:
                            (1) supervisar los Servicios para detectar
                            infracciones; (2) emprender acciones legales oportunas
                            contra infractores; (3) denegar, restringir el acceso,
                            limitar la disponibilidad o inhabilitar cualquiera de
                            sus Contribuciones; (4) eliminar archivos y contenidos
                            de tamaño excesivo; y (5) gestionar los Servicios de
                            un modo diseñado para proteger nuestros derechos y
                            propiedad.
                        </p>
                    </div>

                    {/* ── 15. Política de Privacidad ── */}
                    <div className="space-y-4">
                        <h2 className="t-h4 text-white-95">
                            15. Política de Privacidad
                        </h2>
                        <p className="t-p text-white-80">
                            Nos preocupamos por la privacidad y la seguridad de
                            los datos. Consulte nuestra{" "}
                            <a
                                href="/privacy-policy"
                                className="underline"
                            >
                                Política de Privacidad
                            </a>
                            . Al utilizar los Servicios, usted acepta quedar
                            vinculado por nuestra Política de Privacidad. Los
                            Servicios están alojados en Estados Unidos. Si accede
                            a los Servicios desde cualquier otra región, al
                            continuar utilizando los Servicios estará
                            transfiriendo sus datos a Estados Unidos y consiente
                            expresamente dicha transferencia.
                        </p>
                    </div>

                    {/* ── 16. Duración y Rescisión ── */}
                    <div className="space-y-4">
                        <h2 className="t-h4 text-white-95">
                            16. Duración y Rescisión
                        </h2>
                        <p className="t-p text-white-80">
                            Estas Condiciones Legales permanecerán en pleno vigor
                            y efecto mientras usted utilice los Servicios. NOS
                            RESERVAMOS EL DERECHO, A NUESTRA ENTERA DISCRECIÓN Y
                            SIN PREVIO AVISO NI RESPONSABILIDAD, A DENEGAR EL
                            ACCESO Y EL USO DE LOS SERVICIOS A CUALQUIER PERSONA
                            POR CUALQUIER MOTIVO O SIN MOTIVO ALGUNO. PODEMOS
                            PONER FIN A SU USO O PARTICIPACIÓN EN LOS SERVICIOS O
                            ELIMINAR SU CUENTA Y CUALQUIER CONTENIDO EN CUALQUIER
                            MOMENTO, SIN PREVIO AVISO, A NUESTRA ENTERA
                            DISCRECIÓN.
                        </p>
                        <p className="t-p text-white-80">
                            Si cancelamos o suspendemos su cuenta, se le prohíbe
                            registrarse y crear una nueva cuenta con su nombre, un
                            nombre falso o prestado, o el nombre de un tercero.
                        </p>
                    </div>

                    {/* ── 17. Modificaciones e Interrupciones ── */}
                    <div className="space-y-4">
                        <h2 className="t-h4 text-white-95">
                            17. Modificaciones e Interrupciones
                        </h2>
                        <p className="t-p text-white-80">
                            Nos reservamos el derecho a cambiar, modificar o
                            eliminar el contenido de los Servicios en cualquier
                            momento o por cualquier motivo, a nuestra entera
                            discreción y sin previo aviso. No podemos garantizar
                            que los Servicios estén disponibles en todo momento.
                            Usted acepta que no tenemos responsabilidad alguna por
                            cualquier pérdida causada por su incapacidad para
                            acceder o utilizar los Servicios durante cualquier
                            tiempo de inactividad.
                        </p>
                    </div>

                    {/* ── 18. Derecho Aplicable ── */}
                    <div className="space-y-4">
                        <h2 className="t-h4 text-white-95">
                            18. Derecho Aplicable
                        </h2>
                        <p className="t-p text-white-80">
                            Estas Condiciones Legales y su uso de los Servicios se
                            rigen e interpretan de acuerdo con las leyes del
                            Estado de Delaware, aplicable a los acuerdos
                            celebrados y que deban ejecutarse íntegramente en el
                            Estado de Delaware, sin tener en cuenta sus principios
                            de conflicto de leyes.
                        </p>
                    </div>

                    {/* ── 19. Resolución de Conflictos ── */}
                    <div className="space-y-4">
                        <h2 className="t-h4 text-white-95">
                            19. Resolución de Conflictos
                        </h2>
                        <h3 className="t-p font-semibold text-white-90">
                            Negociaciones informales
                        </h3>
                        <p className="t-p text-white-80">
                            Para agilizar la resolución y controlar el coste de
                            cualquier disputa, las Partes acuerdan intentar
                            primero negociar cualquier Disputa de manera informal
                            durante al menos ciento veinte (120) días antes de
                            iniciar el arbitraje.
                        </p>
                        <h3 className="t-p font-semibold text-white-90">
                            Arbitraje vinculante
                        </h3>
                        <p className="t-p text-white-80">
                            Si las Partes no consiguen resolver una Disputa
                            mediante negociaciones informales, la Disputa se
                            resolverá definitiva y exclusivamente mediante
                            arbitraje vinculante. USTED ENTIENDE QUE SIN ESTA
                            DISPOSICIÓN, TENDRÍA DERECHO A DEMANDAR ANTE UN
                            TRIBUNAL Y A TENER UN JUICIO CON JURADO. El arbitraje
                            se iniciará y se desarrollará con arreglo al
                            Reglamento de Arbitraje Comercial de la Asociación
                            Americana de Arbitraje (&quot;AAA&quot;). El arbitraje
                            tendrá lugar en New Castle, Delaware.
                        </p>
                        <h3 className="t-p font-semibold text-white-90">
                            Restricciones
                        </h3>
                        <p className="t-p text-white-80">
                            Las Partes acuerdan que cualquier arbitraje se
                            limitará a la Disputa entre las Partes
                            individualmente. No se acumulará ningún arbitraje con
                            ningún otro procedimiento; no existe derecho ni
                            autoridad para que ninguna Disputa sea arbitrada sobre
                            la base de una acción colectiva.
                        </p>
                    </div>

                    {/* ── 20. Correcciones ── */}
                    <div className="space-y-4">
                        <h2 className="t-h4 text-white-95">20. Correcciones</h2>
                        <p className="t-p text-white-80">
                            Puede haber información en los Servicios que contenga
                            errores tipográficos, inexactitudes u omisiones. Nos
                            reservamos el derecho a corregir cualquier error,
                            inexactitud u omisión y a modificar o actualizar la
                            información de los Servicios en cualquier momento, sin
                            previo aviso.
                        </p>
                    </div>

                    {/* ── 21. Aviso Legal ── */}
                    <div className="space-y-4">
                        <h2 className="t-h4 text-white-95">21. Aviso Legal</h2>
                        <p className="t-p text-white-80">
                            LOS SERVICIOS SE PRESTAN &quot;TAL CUAL&quot; Y
                            &quot;SEGÚN DISPONIBILIDAD&quot;. USTED ACEPTA QUE EL
                            USO QUE HAGA DE LOS SERVICIOS SERÁ POR SU CUENTA Y
                            RIESGO. EN LA MEDIDA EN QUE LA LEY LO PERMITA,
                            RENUNCIAMOS A TODAS LAS GARANTÍAS, EXPRESAS O
                            IMPLÍCITAS, EN RELACIÓN CON LOS SERVICIOS Y EL USO
                            QUE USTED HAGA DE LOS MISMOS, INCLUIDAS LAS
                            GARANTÍAS IMPLÍCITAS DE COMERCIABILIDAD, IDONEIDAD
                            PARA UN FIN DETERMINADO Y NO INFRACCIÓN.
                        </p>
                    </div>

                    {/* ── 22. Limitaciones de Responsabilidad ── */}
                    <div className="space-y-4">
                        <h2 className="t-h4 text-white-95">
                            22. Limitaciones de Responsabilidad
                        </h2>
                        <p className="t-p text-white-80">
                            EN NINGÚN CASO NOSOTROS O NUESTROS DIRECTORES,
                            EMPLEADOS O AGENTES SEREMOS RESPONSABLES ANTE USTED O
                            ANTE TERCEROS POR NINGÚN DAÑO DIRECTO, INDIRECTO,
                            CONSECUENTE, EJEMPLAR, INCIDENTAL, ESPECIAL O
                            PUNITIVO, INCLUYENDO LUCRO CESANTE, PÉRDIDA DE
                            INGRESOS, PÉRDIDA DE DATOS U OTROS DAÑOS DERIVADOS DE
                            SU USO DE LOS SERVICIOS. NUESTRA RESPONSABILIDAD SE
                            LIMITARÁ EN TODO MOMENTO AL IMPORTE ABONADO POR USTED
                            A NOSOTROS DURANTE LOS TRES (3) MESES ANTERIORES A
                            CUALQUIER CAUSA DE ACCIÓN.
                        </p>
                    </div>

                    {/* ── 23. Indemnización ── */}
                    <div className="space-y-4">
                        <h2 className="t-h4 text-white-95">
                            23. Indemnización
                        </h2>
                        <p className="t-p text-white-80">
                            Usted se compromete a defendernos, indemnizarnos y
                            eximirnos de toda responsabilidad, incluidas nuestras
                            filiales y todos nuestros respectivos funcionarios,
                            agentes y socios, de cualquier pérdida, daño,
                            responsabilidad, reclamación o demanda, incluidos los
                            honorarios razonables de abogados, efectuados por
                            terceros debido a o derivados de: (1) sus
                            Contribuciones; (2) el uso de los Servicios; (3) el
                            incumplimiento de las presentes Condiciones Legales;
                            (4) cualquier incumplimiento de sus declaraciones y
                            garantías; (5) su violación de los derechos de un
                            tercero; o (6) cualquier acto perjudicial manifiesto
                            hacia cualquier otro usuario de los Servicios.
                        </p>
                    </div>

                    {/* ── 24. Datos de Usuario ── */}
                    <div className="space-y-4">
                        <h2 className="t-h4 text-white-95">
                            24. Datos de Usuario
                        </h2>
                        <p className="t-p text-white-80">
                            Conservaremos determinados datos que usted transmita a
                            los Servicios con el fin de gestionar su
                            funcionamiento. Aunque realizamos copias de seguridad
                            periódicas, usted es el único responsable de todos los
                            datos que transmita. Usted acepta que no tendremos
                            ninguna responsabilidad ante usted por la pérdida o
                            corrupción de dichos datos.
                        </p>
                    </div>

                    {/* ── 25. Comunicaciones Electrónicas ── */}
                    <div className="space-y-4">
                        <h2 className="t-h4 text-white-95">
                            25. Comunicaciones, Transacciones y Firmas
                            Electrónicas
                        </h2>
                        <p className="t-p text-white-80">
                            La visita a los Servicios, el envío de correos
                            electrónicos y la cumplimentación de formularios en
                            línea constituyen comunicaciones electrónicas. Usted
                            da su consentimiento para recibir comunicaciones
                            electrónicas, y acepta que todos los acuerdos, avisos,
                            divulgaciones y otras comunicaciones que le
                            proporcionemos electrónicamente satisfacen cualquier
                            requisito legal de que dicha comunicación sea por
                            escrito. POR LA PRESENTE, USTED ACEPTA EL USO DE
                            FIRMAS, CONTRATOS, PEDIDOS Y OTROS REGISTROS
                            ELECTRÓNICOS, ASÍ COMO LA ENTREGA ELECTRÓNICA DE
                            NOTIFICACIONES, POLÍTICAS Y REGISTROS DE
                            TRANSACCIONES.
                        </p>
                    </div>

                    {/* ── 26. California ── */}
                    <div className="space-y-4">
                        <h2 className="t-h4 text-white-95">
                            26. Usuarios y Residentes de California
                        </h2>
                        <p className="t-p text-white-80">
                            Si cualquier reclamación con nosotros no se resuelve
                            satisfactoriamente, puede ponerse en contacto con la
                            Unidad de Reclamaciones de la División de Servicios al
                            Consumidor del Departamento de Asuntos del Consumidor
                            de California por escrito a 1625 North Market Blvd,
                            Suite N 112, Sacramento, California 95834 o por
                            teléfono llamando al (800) 952-5210 o al (916)
                            445-1254.
                        </p>
                    </div>

                    {/* ── 27. Varios ── */}
                    <div className="space-y-4">
                        <h2 className="t-h4 text-white-95">27. Varios</h2>
                        <p className="t-p text-white-80">
                            Las presentes Condiciones Legales y cualesquiera
                            políticas o normas de funcionamiento publicadas por
                            nosotros en los Servicios constituyen la totalidad del
                            acuerdo y entendimiento entre usted y nosotros. El
                            hecho de que no ejerzamos cualquier derecho o
                            disposición no constituirá una renuncia a dicho
                            derecho. Si se determina que alguna disposición es
                            ilegal, nula o inaplicable, dicha disposición se
                            considerará separable y no afectará a la validez de
                            las disposiciones restantes. No se crea ninguna
                            relación de empresa conjunta, asociación, empleo o
                            agencia entre usted y nosotros como resultado de
                            estas Condiciones Legales.
                        </p>
                    </div>

                    {/* ── 28. Anexo de Cumplimiento ── */}
                    <div className="space-y-4">
                        <h2 className="t-h4 text-white-95">
                            28. Anexo de Cumplimiento: Disposiciones
                            Suplementarias para el Cumplimiento de Anthropic
                            (Claude), OpenAI (ChatGPT), Google OAuth y la Tienda
                            de Aplicaciones de Shopify
                        </h2>

                        <h3 className="t-p font-semibold text-white-90">
                            Section 1 — Data Retention Policy
                        </h3>
                        <p className="t-p text-white-80">
                            All connected platform data — including data retrieved
                            from Meta Ads, Google Ads, TikTok Ads, Shopify,
                            WooCommerce, and Google Analytics 4 — is retained for
                            the duration of the active subscription period and for
                            a grace period of thirty (30) days following account
                            cancellation. Upon account deletion or termination,
                            all user data and associated platform tokens are
                            permanently purged within thirty (30) days. Users may
                            request immediate deletion at any time by contacting{" "}
                            <a
                                href="mailto:privacy@adray.ai"
                                className="underline"
                            >
                                privacy@adray.ai
                            </a>
                            .
                        </p>

                        <h3 className="t-p font-semibold text-white-90">
                            Section 2 — Data Sharing and Third-Party Disclosure
                        </h3>
                        <p className="t-p text-white-80">
                            When a merchant connects Adray to an AI system
                            (including Claude by Anthropic and ChatGPT by OpenAI),
                            Adray transmits only aggregated, normalized marketing
                            performance metrics. This includes spend, impressions,
                            clicks, ROAS, conversion counts and attributed revenue
                            at the campaign or ad set level, and cross-channel
                            performance summaries.
                        </p>
                        <p className="t-p text-white-80">
                            Adray does not transmit raw OAuth tokens or API
                            credentials, raw API responses from connected
                            platforms, or end-customer personally identifiable
                            information (PII) to any AI system. Adray does not
                            sell, rent, or lease user data to any third party
                            under any circumstances.
                        </p>

                        <h3 className="t-p font-semibold text-white-90">
                            Section 3 — User Scope and Data Classification
                        </h3>
                        <p className="t-p text-white-80">
                            The primary data subject is the merchant — the
                            business entity or individual that creates an Adray
                            account. To the extent that merchant platforms contain
                            data about end customers, Adray treats all such data
                            as merchant business data processed under a B2B data
                            processing relationship. Adray does not expose
                            end-customer PII to AI systems or third parties. Adray
                            acts as a data processor on behalf of the merchant
                            (data controller). By connecting a Shopify store or
                            other ecommerce platform, merchants agree to
                            Adray&apos;s Data Processing Agreement (DPA).
                        </p>

                        <h3 className="t-p font-semibold text-white-90">
                            Section 4 — Platform-Specific Compliance Disclosures
                        </h3>
                        <p className="t-p text-white-80">
                            <strong>
                                4.1 Anthropic (Claude Connector):
                            </strong>{" "}
                            Adray&apos;s integration with Claude transmits only
                            aggregated marketing performance data. No PII is
                            included in any prompt, context, or message sent to
                            Claude. Adray complies with Anthropic&apos;s usage
                            policies.
                        </p>
                        <p className="t-p text-white-80">
                            <strong>
                                4.2 OpenAI (ChatGPT Actions / Plugin):
                            </strong>{" "}
                            Adray does not use data retrieved via OpenAI&apos;s
                            API to train or improve its own models. Data shared
                            with ChatGPT is limited to aggregated marketing
                            metrics.
                        </p>
                        <p className="t-p text-white-80">
                            <strong>
                                4.3 Google API Limited Use Policy:
                            </strong>{" "}
                            Adray&apos;s use of Google APIs complies with
                            Google&apos;s API Services User Data Policy and the
                            Limited Use requirements. Adray uses Google user data
                            only to provide the marketing data normalization and
                            reporting services described to users at the point of
                            authorization. Adray does not use Google user data for
                            serving advertisements, does not allow humans to read
                            Google user data without explicit permission, and does
                            not transfer Google user data to third parties except
                            as necessary.
                        </p>
                        <p className="t-p text-white-80 italic">
                            Adray&apos;s use of information received from Google
                            APIs will adhere to the Google API Services User Data
                            Policy, including the Limited Use requirements.
                        </p>
                        <p className="t-p text-white-80">
                            <strong>4.4 Shopify App Store:</strong>{" "}
                            Adray&apos;s Shopify integration complies with
                            Shopify&apos;s Partner Program Agreement. Adray
                            requests only the minimum API scopes required,
                            provides merchants with data deletion upon app
                            uninstallation (customers/redact, shop/redact,
                            customers/data_request), and does not store Shopify
                            customer PII beyond what is strictly necessary.
                        </p>
                        <p className="t-p text-white-80 text-sm italic">
                            This addendum supplements Adray&apos;s existing Terms
                            of Service and Privacy Policy. In the event of any
                            conflict, this addendum shall govern with respect to
                            platform-specific compliance obligations. Last
                            updated: February 2026 | Contact:{" "}
                            <a
                                href="mailto:privacy@adray.ai"
                                className="underline"
                            >
                                privacy@adray.ai
                            </a>
                        </p>
                    </div>

                    {/* ── 29. Contacto ── */}
                    <div className="space-y-4">
                        <h2 className="t-h4 text-white-95">29. Contacto</h2>
                        <p className="t-p text-white-80">
                            Para resolver una queja relativa a los Servicios o
                            para recibir más información, póngase en contacto con
                            nosotros en:
                        </p>
                        <p className="t-p text-white-80">
                            Adray, Inc.
                            <br />
                            1111B S Governors Avenue STE 53849
                            <br />
                            Dover, DE 19904
                            <br />
                            United States
                            <br />
                            Teléfono: +16194968692
                            <br />
                            <a
                                href="mailto:contact@adray.ai"
                                className="underline"
                            >
                                contact@adray.ai
                            </a>
                        </p>
                    </div>
                </div>
            </Container>
        </section>
    );
}
