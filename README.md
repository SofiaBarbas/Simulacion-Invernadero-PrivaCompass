# Simulación del Sistema de Control Priva Compass
TFI de Tecnologías para la Automatización (UTNFRBA - Curso K4521)

Simulación en tiempo real del sistema de lazo cerrado de temperatura de un sector
del invernadero de Leen van Velden, controlado con Priva Compass.

Integrantes: Sofía Barbás

**Ver el simulador:** https://sofiabarbas.github.io/Simulacion-Invernadero-PrivaCompass/

## Qué permite hacer
- Iniciar, pausar y continuar la simulación
- Variar el valor de referencia y ver cómo responde la salida
- Agregar perturbaciones externas
- Cambiar los parámetros del controlador PI y activar el feedforward

## Cómo está hecho
- `index.html`: estructura de la interfaz
- `style.css`: estilos
- `simulacion.js`: modelo de la planta (método de Euler), controlador y gráficos

Los parámetros del modelo son supuestos para obtener una dinámica realista;
no son datos publicados por Priva.

