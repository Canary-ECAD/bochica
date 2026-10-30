<p align="center"><img src="apps/desktop/build/icon.png" alt="Logo de Bochica" width="112"></p>

# Bochica

[English](README.md) · **Español**

**Bochica by Canary-ECAD** es una app de escritorio open source para Windows que permite a
cualquier persona trabajar con EPLAN Electric P8 mediante un agente de IA, sin programar ni usar
la línea de comandos. Instálala, pega una API key del proveedor de IA que prefieras y describe
lo que quieres con tus propias palabras.

> **Estado:** desarrollo inicial. Descarga el instalador desde
> [Releases](https://github.com/Canary-ECAD/bochica/releases/latest); a partir de ahí, Bochica se
> actualiza sola. Conversa con cualquier proveedor, responde con la documentación de EPLAN, actúa
> en EPLAN con tu aprobación, trabaja con archivos y PowerShell en la carpeta que elijas y admite
> tus propias skills. El instalador aún no está firmado, así que Windows SmartScreen puede avisar
> la primera vez.

## Qué incluye

- Una interfaz de chat limpia con sesiones, al estilo de los asistentes de IA para programar.
- Funciona con Anthropic, OpenAI, Google Gemini, OpenRouter o modelos locales (Ollama, LM
  Studio).
- Integración con EPLAN lista para usar, sin configurar nada:
  - [eplan-mcp](https://github.com/Canary-ECAD/eplan-mcp): controla una instancia de EPLAN
    abierta.
  - [eplan-scripting-skill](https://github.com/Canary-ECAD/eplan-scripting-skill): enseña al
    agente a escribir scripts de EPLAN Electric P8 correctos.
  - [eec-pro-skill](https://github.com/Canary-ECAD/eec-pro-skill): lo mismo para EPLAN EEC Pro
    (típicos, fórmulas, Job Server, generación).
  - [eplan-cloudflare-rags](https://github.com/Canary-ECAD/eplan-cloudflare-rags): busca en la
    documentación de EPLAN (P8 2027 siempre activo; P8 2026 y EEC Pro opcionales).
- Deshacer: vuelve a un mensaje anterior y los archivos que cambió el agente quedan como
  estaban.
- Primero un plan, o que trabaje solo: pide un plan para aprobarlo antes de cambiar nada, decide
  qué se permite siempre y qué nunca, o pasa una sesión a modo Auto.
- Actualizaciones con un clic.

## Requisitos

- Windows 10 u 11 (64 bits).
- EPLAN Electric P8 2024–2027, con **File → Settings → Workstation → Interfaces → Remote
  access → "Allow remote access via Remote Client"** activado.
- Una API key de un proveedor compatible, o un servidor de modelos local.

Nada más: el instalador lleva su propio Python con el servidor de EPLAN y las skills integradas,
así que no descarga nada para empezar (un proxy corporativo no es problema) y nunca toca un Python que
tengas instalado. Al abrirla por primera vez, una guía corta conecta un modelo, comprueba EPLAN y
hace una primera pregunta.

## Actualizaciones

Bochica busca versiones nuevas por su cuenta. Cuando hay una, un aviso al pie de la barra lateral
ofrece **Actualizar ahora** (descarga, reinicia y listo; espera a que termine la tarea en curso)
o **Más tarde** (se instala la próxima vez que cierres Bochica). Una sola actualización lo cubre
todo: la aplicación y los componentes de EPLAN que lleva. Nada se actualiza sin uno de esos
clics, y si una actualización falla, la versión instalada sigue funcionando. Ajustes → General →
Actualizaciones muestra la versión y permite buscar en el momento.

## Desarrollo

Requiere [Bun](https://bun.sh).

```bash
bun install
bun run dev
```

Comprobaciones: `bun run typecheck`, `bun run lint`, `bun run format:check`, `bun run knip`,
`bun test`. La arquitectura está descrita en [CLAUDE.md](CLAUDE.md).

`bun run package` genera el instalador en `apps/desktop/release`. Su primer paso,
`bun run --filter @bochica/desktop runtime`, descarga el Python, eplan-mcp y las skills fijados
en `apps/desktop/runtime` y comprueba que el servidor de EPLAN arranca; `bun run dev` también
usa esa carpeta cuando existe. Las versiones las genera CI a partir de una etiqueta de versión;
los pasos, y cómo actualizar un componente de EPLAN, están en
[docs/releasing.md](docs/releasing.md) (en inglés).

## Licencia

MIT; ver [LICENSE](LICENSE).

> **Aviso:** este es un proyecto comunitario independiente de
> [Canary E-cad](https://github.com/Canary-ECAD). No está afiliado, respaldado ni soportado por
> EPLAN GmbH & Co. KG. EPLAN, EPLAN Electric P8 y EPLAN EEC Pro son marcas de su respectivo
> titular.
