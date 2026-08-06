# Cursado 2026

This is a [Next.js](https://nextjs.org) project bootstrapped with [v0](https://v0.app).

## Built with v0

This repository is linked to a [v0](https://v0.app) project. You can continue developing by visiting the link below -- start new chats to make changes, and v0 will push commits directly to this repo. Every merge to `main` will automatically deploy.

[Continue working on v0 →](https://v0.app/chat/projects/prj_iGGl2OX2U2EmCIzdCTqF1UkU6sUE)

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

## Storage

La aplicación usa un workspace local elegido por el usuario para materias, PDFs y manifiestos. No requiere una base de datos SQL.

Las salidas de InSreen usan Cloudflare R2 para que otro programa pueda consumir los TXT. Su estado técnico se guarda por separado bajo `manifests/inscreen/`.

Required environment variables for R2:

```bash
R2_BUCKET_NAME=
R2_ENDPOINT=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
```

### Lectura desde la APK

El despliegue funciona como intermediario de solo lectura entre la APK y R2. Configura
en Vercel las credenciales R2 anteriores y un token independiente de al menos 32 bytes:

```bash
INSCREEN_PROVIDER_TOKEN=un-token-aleatorio-largo-y-exclusivo-para-la-apk
INSCREEN_PROVIDER_ACCOUNT_EMAIL=local@app.local
```

`INSCREEN_PROVIDER_ACCOUNT_EMAIL` es opcional y por defecto usa `local@app.local`, que
es la cuenta del modo de almacenamiento local. El token del proveedor no es una
credencial de R2 y debe enviarse en `Authorization: Bearer ...`.

Las rutas disponibles son:

```text
GET /api/inscreen/provider/paginas-leidas?materia=ecuordinarias&dia=6
GET /api/inscreen/provider/traducciones?materia=ecuordinarias&dia=6
```

`materia` es el nombre exacto de la carpeta normalizada bajo `InSreen/`, por ejemplo
`ecuordinarias`. Se admiten materias creadas por el usuario y no solamente las del
catalogo inicial. `dia` acepta enteros de 6 (dia de clase) a 0 (dia anterior a la
clase siguiente). El proveedor resuelve internamente la etapa mediante sus manifiestos
y el metadato `subject-id` existente.

La respuesta publica contiene solamente `ok` y `archivos`. Cada archivo conserva su
nombre y el contenido exacto del TXT guardado en R2:

```json
{
  "ok": true,
  "archivos": [
    { "nombre": "1.txt", "contenido": "Contenido original del TXT" }
  ]
}
```

Sin resultados se devuelve `{ "ok": true, "archivos": [] }`; cualquier error devuelve
`{ "ok": false, "archivos": [] }` con el codigo HTTP correspondiente.

Ejemplo:

```bash
curl -H "Authorization: Bearer $INSCREEN_PROVIDER_TOKEN" \
  "https://v0-lunas-moradas.vercel.app/api/inscreen/provider/paginas-leidas?materia=ecuordinarias&dia=6"
```

## Configuracion personal de InScreen

En el despliegue solo debe configurarse una semilla privada del servidor:

```bash
INSCREEN_CONFIG_SEED=una-cadena-aleatoria-de-al-menos-32-caracteres
```

No compartas esa semilla ni la incluyas en Git. Debe conservarse estable: si se
cambia, las configuraciones `User.InScreen` creadas anteriormente dejaran de
poder descifrarse y el asistente solicitara las credenciales de nuevo.

Al abrir el modo local por primera vez, la aplicacion pide una carpeta y luego
muestra un asistente claro de tres pasos para Groq, Marker y Cloudflare R2. Las
credenciales se cifran en el servidor. La Mitad A del sobre cifrado se guarda en
`User.InScreen`, dentro de la carpeta elegida. La Mitad B vuelve directamente
como una cookie persistente `HttpOnly`, `SameSite=Strict` y `Secure` en
produccion; JavaScript nunca recibe esa mitad. Cada operacion remota envia A y
el navegador adjunta B solamente al mismo origen. Ninguna mitad contiene por si
sola las API keys en texto plano.

El asistente puede omitirse para usar la aplicacion sin Groq, Marker ni R2. La
preferencia queda guardada en ese navegador y no vuelve a interrumpir las
cargas. Para abrir nuevamente la configuracion, pulsa `|` desde la pantalla de
inicio.

Recommended Cloudflare R2 CORS configuration for operational hardening:

- Origins: production Vercel domain and `http://localhost:3000`
- Methods: `PUT`, `GET`, `HEAD`, `OPTIONS`, `DELETE`
- Allowed headers: `Content-Type`, `x-amz-meta-*`
- Expose headers: `ETag`

## Learn More

To learn more, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.
- [v0 Documentation](https://v0.app/docs) - learn about v0 and how to use it.
