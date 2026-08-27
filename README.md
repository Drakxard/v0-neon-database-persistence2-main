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

Los PDF de materiales pueden replicarse en el Google Drive conectado por cada navegador desde el panel `|`. La copia semanal usa `Cursado2026/{materia}/Semana {n}/{contenedor}`; los contenedores fijados se guardan una sola vez en `Cursado2026/{materia}/Fijos/{contenedor}` y cada semana contiene un acceso directo a `Fijos`. La replica no reemplaza el workspace local. Vercel conserva solamente las credenciales OAuth de la aplicacion; cada refresh token se cifra y divide entre `User.Drive` y una cookie HttpOnly.

La aplicación usa un workspace local elegido por el usuario para materias, PDFs y manifiestos. No requiere una base de datos SQL.

Las salidas de InSreen usan Cloudflare R2 para que otro programa pueda consumir los TXT. Su estado técnico se guarda por separado bajo `manifests/inscreen/`.

Required environment variables for R2:

```bash
R2_BUCKET_NAME=
R2_ENDPOINT=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
```

### Vinculacion de la APK sin base central

El despliegue funciona como intermediario sin estado entre cada APK y el R2 de su
propietario. No se guardan usuarios ni credenciales en Neon y no se crean variables de
entorno por persona. En Vercel configura una unica semilla adicional y estable:

```bash
INSCREEN_PROVIDER_CAPSULE_SECRET=otra-cadena-aleatoria-de-al-menos-32-caracteres
```

Al terminar los pasos Groq, Marker y R2, la web muestra un cuarto paso con un QR valido
durante cinco minutos. El QR contiene un paquete AES-256-GCM opaco, nunca las claves
legibles. Android lo canjea una sola vez y recibe por HTTPS la clave Groq y una capsula
propia del dispositivo que contiene R2 y Marker. Groq queda protegido con Android
Keystore; R2 y Marker permanecen cifrados dentro de la capsula y solo se abren en memoria
en Vercel. La clave Marker nunca se devuelve como un campo legible al APK.

El estado se distribuye en el R2 de cada usuario:

```text
manifests/inscreen/provider/pairings/<pairingId>.json
manifests/inscreen/provider/devices/<deviceId>.json
manifests/inscreen/provider/widget-targets-v1.json
```

Cada consulta envia la capsula en `Authorization: Bearer ...`. El proveedor obtiene de
ella el R2 correcto, verifica en ese mismo R2 que el dispositivo siga activo y devuelve
los TXT. La pantalla final permite generar otro QR y revocar telefonos individualmente.
Cambiar `INSCREEN_PROVIDER_CAPSULE_SECRET` invalida todas las vinculaciones; cambiar las
credenciales R2 exige revocar y volver a vincular los dispositivos.

Las rutas disponibles son:

```text
GET /api/inscreen/provider/paginas-leidas?materia=ecuordinarias&dia=6
GET /api/inscreen/provider/traducciones?materia=ecuordinarias&dia=6
GET /api/inscreen/provider/traducciones?materia=ecuordinarias&ultimo=6.txt
POST /api/inscreen/provider/marker-transcribe
GET /api/inscreen/provider/widget-targets
GET /api/inscreen/provider/widget-targets?subjectId=eo&kind=notebooklm
```

`marker-transcribe` recibe un único JPG, PNG o WebP en el campo multipart `file`, exige
la misma cápsula Bearer y devuelve `{ ok: true, markdown }`. El límite por imagen es
4 MiB. Una cápsula emitida antes de incluir Marker conserva acceso a las rutas R2, pero
esta ruta responde `428` con `provider_repair_required` hasta volver a vincular el APK.

`materia` es el nombre exacto de la carpeta normalizada bajo `InSreen/`, por ejemplo
`ecuordinarias`. Se admiten materias creadas por el usuario y no solamente las del
catalogo inicial. `dia` acepta enteros de 6 (dia de clase) a 0 (dia anterior a la
clase siguiente). El proveedor resuelve internamente la etapa mediante sus manifiestos
y el metadato `subject-id` existente.

En el modo incremental se omite `dia`. `ultimo` contiene el último TXT conocido por la
APK; sin ese parámetro se devuelve completa la etapa semanal más reciente dentro de
`nuevaEtapa`. Los archivos posteriores de la semana conocida permanecen en `archivos` y
el reinicio en `1.txt` se entrega por separado en `nuevaEtapa`. Sin novedades se devuelve
`hayNuevos: false`, `archivos: []` y `nuevaEtapa: null`.

La respuesta incremental contiene `ok`, `hayNuevos`, `archivos` y `nuevaEtapa`. Cada archivo conserva su
nombre y el contenido exacto del TXT guardado en R2:

```json
{
  "ok": true,
  "hayNuevos": true,
  "archivos": [
    { "nombre": "7.txt", "contenido": "Contenido de la etapa conocida" }
  ],
  "nuevaEtapa": {
    "etapa": 15,
    "archivos": [
      { "nombre": "1.txt", "contenido": "Contenido de la nueva etapa" }
    ]
  }
}
```

Sin resultados se devuelve `{ "ok": true, "hayNuevos": false, "archivos": [], "nuevaEtapa": null }`; cualquier error devuelve
`{ "ok": false, "archivos": [] }` con el codigo HTTP correspondiente.

Las rutas no aceptan ya un token global compilado. Una APK sin vincular responde
`provider_not_configured` y debe escanear el QR del despliegue que genero su configuracion.

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
