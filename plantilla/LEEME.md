# Instala tu propia app de gastos

La app (esta página en GitHub Pages) es la misma para todos. Tus datos quedan en **tu** Google Drive, en una hoja con su propio script. Nadie más los ve.

Tiempo: unos 10 minutos, desde un computador.

## Archivos

| Archivo | Para qué |
| --- | --- |
| `Codigo.gs` | El script que conecta la hoja con la app. Obligatorio. |
| `Correos.gs` | Lectura automática de correos del banco. Opcional: sin él, Google no pide acceso a tu Gmail. |
| `Gastos-plantilla.xlsx` | La hoja vacía, para instalar sin el link de copia. |

## Pasos

**Forma rápida:** pídele a Cris el link de copia (termina en `/copy`). Al abrirlo, Google te ofrece hacer una copia que ya trae `Codigo.gs`: haz la copia y parte en el paso 4.

**Forma manual:**

1. **Descarga** `Gastos-plantilla.xlsx` (botón *Download raw file* en GitHub).
2. **Súbelo a Google Drive**, ábrelo y usa *Archivo → Guardar como Hoja de cálculo de Google*. Trabaja en esa copia.
3. En la hoja: *Extensiones → Apps Script*. Borra lo que haya, pega todo `Codigo.gs` y guarda (ícono de disquete).
4. En *Extensiones → Apps Script*, arriba en `Codigo.gs`, edita la sección **TUS DATOS**: tu nombre como lo escriben los bancos, tus categorías, medios de pago y día de corte del sueldo. Guarda.
5. Vuelve a la hoja y **recarga la página**. Aparece el menú **Gastos**. Elige *Gastos → Configurar* y autoriza los permisos.
   - Google mostrará *"Google no verificó esta app"*. Es normal en scripts propios: *Configuración avanzada → Ir a … (no seguro)*. El script solo corre en tu cuenta.
6. En Apps Script: *Implementar → Nueva implementación* → engranaje → *Aplicación web*.
   - Ejecutar como: **Yo**
   - Quién tiene acceso: **Cualquier usuario**
   - Copia la URL que termina en `/exec`.
7. En la hoja: *Gastos → Ver clave de la app*.
8. Abre la app en el celular, toca el engranaje y pega la **URL** y la **clave**. Para instalarla: menú del navegador → *Agregar a la pantalla principal*.

## Opcional: registro automático

- **Correos de Banco de Chile / Edwards:** en Apps Script, *+ junto a Archivos → Secuencia de comandos*, nómbralo `Correos` y pega `Correos.gs`. Recarga la hoja y usa *Gastos → Activar lectura de correos del banco*. Lee tu Gmail cada 10 minutos, desde el día en que lo actives. Otros bancos aún no están soportados.
- **Notificaciones push (Android):** con MacroDroid se puede reenviar el aviso de compra del banco a la URL `/exec` con `{"action":"notif","key":"<tu clave>","texto":"<texto de la notificación>"}`. Hoy solo entiende el formato de Santander.
- **iPhone:** no permite reenviar notificaciones; usa el registro manual con el botón **+**.

## Si algo falla

- **"Clave incorrecta":** vuelve a copiar la clave desde *Gastos → Ver clave de la app*.
- **"No hubo respuesta":** revisa que la implementación tenga acceso *Cualquier usuario*.
- **Cambiaste `Codigo.gs`:** *Implementar → Administrar implementaciones → editar (lápiz) → Versión: Nueva versión*. Así la URL sigue igual.
- **Perdiste el celular o compartiste la clave:** *Gastos → Cambiar clave* y vuelve a conectar la app.

## Reglas

- No cambies los nombres de las pestañas ni el orden de sus columnas: la app escribe en ellas.
- Las categorías que empiezan con `_` están reservadas y no cuentan como gasto.
- En **Reglas**, si la descripción de un gasto contiene el texto de la columna A, se categoriza solo. Agrega las tuyas.
