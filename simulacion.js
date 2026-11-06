/* MÉTODO DE EULER
   El tiempo se divide en pasos cortos (PASO = 0,02 min = 1,2 s) para simular la continuidad.
   En cada paso se calcula:
   temperatura_nueva = temperatura_actual + (velocidad de cambio × PASO)
*/

// ===== PARÁMETROS SUPUESTOS DEL MODELO =====
const parametros = {
    constanteTiempo: 20,       // inercia térmica del sector (min)
    gananciaCalefaccion: 25,   // °C que sube la calefacción al 100 % por encima del exterior
    gananciaSol: 0.02,         // °C que aporta cada W/m² de radiación solar
    perdidaVentanas: 4,        // pérdida extra de calor con las ventanas al 100 %
    perdidaPuerta: 1.5,        // pérdida extra con la puerta abierta
    retardoCalefaccion: 3,     // retardo de cada etapa de la calefacción por tubos (min)
    retardoSensor: 0.5,        // retardo del sensor (min)
    ruidoSensor: 0.03          // desvío estándar del ruido del sensor (°C)
};

const PASO = 0.02;    // paso de integración (min)
const REGISTRO = 0.1; // cada cuántos minutos simulados se guarda un punto para los gráficos
const VENTANA = 120;  // minutos visibles en los gráficos
const MEMORIA = 240;  // minutos de historia que se guardan


// ===== ENTRADAS FIJAS =====
const entrada = {
    referencia: 20,          // valor de referencia (°C)
    tempExterior: 8,         // temperatura exterior (°C)
    radiacion: 150,          // radiación solar (W/m²)
    viento: 3,               // viento (m/s)
    lluvia: false,
    kp: 0.25,                // ganancia proporcional del PI
    ti: 15,                  // tiempo integral del PI (min)
    offsetVentilacion: 2,    // °C por encima de la referencia donde empiezan a abrir las ventanas
    bandaVentanas: 3,        // banda proporcional de las ventanas (°C)
    feedforward: false       // compensación por radiación
};


// ===== ESTADO DEL SISTEMA =====
let estado;
let historia;          // valores pasados, para los gráficos
let proximoRegistro;   // tiempo en que se guarda el próximo punto

function reiniciar() {
    estado = {
        tiempo: 0,                  // tiempo simulado (min)
        tempReal: 20,               // temperatura real del aire (°C)
        tempMedida: 20,             // temperatura que "ve" el sensor (°C)
        etapa1Calefaccion: 0.4,     // primera etapa de retardo de la calefacción
        potenciaCalefaccion: 0.4,   // calor que llega al aire (0 a 1)
        integral: 0.4,              // parte integral del PI (paso 5)
        ordenCalefaccion: 0.4,      // orden que da el controlador a la calefacción (0 a 1)
        aperturaVentanas: 0,        // apertura de las ventanas (0 a 1)
        salida: 20                  // medición con ruido: la salida del sistema (°C)
    };

    historia = {
        tiempo: [], salida: [], referencia: [], tempExterior: [],
        calefaccion: [], ventanas: [], radiacion: []
    };
    proximoRegistro = 0;
}

// numero aleatorio con distribución normal para el ruido del sensor
function ruidoGaussiano() {
    const u = 1 - Math.random(), v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ===== CONTROLADOR =====
// limita al valor en un rango
// esta es una de las no linealidades del sistema (no baja de 0 ni sube de 100)
function limitar(valor, minimo, maximo) {
    return Math.min(maximo, Math.max(minimo, valor));
}

// Calefacción: control PI (válvula mezcladora), con feedforward opcional
function controlCalefaccion(error) {
    const parteProporcional = entrada.kp * error;
    const parteIntegral = entrada.ti > 0 ? estado.integral : 0;   // ti = 0 → sólo P

    // Feedforward: si hay sol, bajamos la calefacción por adelantado
    // en la misma cantidad de calor que va a aportar el sol
    const compensacionSol = entrada.feedforward
        ? (parametros.gananciaSol * entrada.radiacion) / parametros.gananciaCalefaccion
        : 0;

    const ordenSinLimite = parteProporcional + parteIntegral - compensacionSol;
    const orden = limitar(ordenSinLimite, 0, 1);

    // Actualiza la integral, salvo que la válvula ya esté al tope
    if (entrada.ti > 0) {
        const topeArriba = ordenSinLimite >= 1 && error > 0;
        const topeAbajo = ordenSinLimite <= 0 && error < 0;
        if (!topeArriba && !topeAbajo) {
        estado.integral += (entrada.kp / entrada.ti) * error * PASO;
        }
    }
    return orden;
}

// Ventanas: control proporcional con banda
function controlVentanas(medicion) {
    const umbral = entrada.referencia + entrada.offsetVentilacion; // desde aca empiezan a abrir
    let apertura = (medicion - umbral) / entrada.bandaVentanas;    // 0 en el umbral, 1 al final de la banda
    apertura = limitar(apertura, 0, 1);
    if (entrada.lluvia) apertura = Math.min(apertura, 0.1);        // con lluvia, como mucho 10 %
    return apertura;
}

function pasoSimulacion() {
    const p = parametros;

    // --- Elemento de medicion: el sensor sigue a la temperatura real con retardo ---
    estado.tempMedida += PASO * (estado.tempReal - estado.tempMedida) / p.retardoSensor;
    estado.salida = estado.tempMedida + p.ruidoSensor * ruidoGaussiano();

    // --- Controlador: compara la medicion con la referencia y decide ---
    const error = entrada.referencia - estado.salida;          // e = r − y
    const ordenCalefaccion = controlCalefaccion(error);
    const aperturaVentanas = controlVentanas(estado.salida);

    // --- Actuador de calefacción: dos etapas de retardo (el agua tarda en calentar los tubos) ---
    estado.etapa1Calefaccion += PASO * (ordenCalefaccion - estado.etapa1Calefaccion) / p.retardoCalefaccion;
    estado.potenciaCalefaccion += PASO * (estado.etapa1Calefaccion - estado.potenciaCalefaccion) / p.retardoCalefaccion;

    // --- Planta: balance de calor del aire del sector ---
    const viento = entrada.viento;
    const perdidas = 1 + p.perdidaVentanas * aperturaVentanas * (1 + 0.15 * viento) + 0.03 * viento;
    const calorQueSale = perdidas * (estado.tempReal - entrada.tempExterior);
    const calorCalefaccion = p.gananciaCalefaccion * estado.potenciaCalefaccion;
    const calorSol = p.gananciaSol * entrada.radiacion;
    const velocidadDeCambio = (calorCalefaccion + calorSol - calorQueSale) / p.constanteTiempo;

    estado.tempReal += PASO * velocidadDeCambio; // método de Euler

    // guarda para despues mostrar
    estado.ordenCalefaccion = ordenCalefaccion;
    estado.aperturaVentanas = aperturaVentanas;
    estado.tiempo += PASO;
    registrarHistoria();
}

// guarda un punto cada REGISTRO minutos y borra lo más viejo
function registrarHistoria() {
    if (estado.tiempo < proximoRegistro) return;
    proximoRegistro += REGISTRO;

    historia.tiempo.push(estado.tiempo);
    historia.salida.push(estado.salida);
    historia.referencia.push(entrada.referencia);
    historia.tempExterior.push(entrada.tempExterior);
    historia.calefaccion.push(estado.ordenCalefaccion * 100);   // en %
    historia.ventanas.push(estado.aperturaVentanas * 100);      // en %
    historia.radiacion.push(entrada.radiacion);

    while (historia.tiempo.length > 0 && historia.tiempo[0] < estado.tiempo - MEMORIA) {
        for (const clave in historia) historia[clave].shift();
    }
}

// avanza la simulación
// si el tiempo pedido no alcanza para un paso completo, lo guarda y lo suma en el próximo cuadro
let tiempoPendiente = 0;
function avanzar(minutos) {
  tiempoPendiente += minutos;
  while (tiempoPendiente >= PASO) {
    pasoSimulacion();
    tiempoPendiente -= PASO;
  }
}


// ===== INTERFAZ =====
// ===== HERRAMIENTAS =====
// busca un elemento de la página por su id del HTML
function elemento(id) {
    return document.getElementById(id);
}

// decimales redonditos
function formatear(valor, decimales) {
    return valor.toFixed(decimales).replace(".", ",");
}

function formatearConSigno(valor, decimales) {
  const texto = formatear(Math.abs(valor), decimales);
  if (Number(texto.replace(",", ".")) === 0) return texto;
  return (valor > 0 ? "+" : "−") + texto;
}

// conversor de minutos simulados a formato reloj
function reloj(minutos) {
    const horas = Math.floor(minutos / 60);
    const mins = Math.floor(minutos) % 60;
    return horas + ":" + (mins < 10 ? "0" : "") + mins;
}


// ===== INDICADORES =====

// promedio de un dato de la historia en los últimos minutos simulados
function promedioReciente(dato, minutos, respaldo) {
    let suma = 0, cantidad = 0;
    for (let i = historia.tiempo.length - 1; i >= 0 && historia.tiempo[i] >= estado.tiempo - minutos; i--) {
        suma += historia[dato][i];
        cantidad++;
    }
    return cantidad > 0 ? suma / cantidad : respaldo;
}

function actualizarIndicadores() {
    // Valores filtrados: promedio del último minuto simulado, para que el ruido no haga temblar los números
    const tempMostrada = promedioReciente("salida", 1, estado.salida);
    const calefaccionMostrada = promedioReciente("calefaccion", 1, estado.ordenCalefaccion * 100);
    const ventanasMostradas = promedioReciente("ventanas", 1, estado.aperturaVentanas * 100);

    const error = entrada.referencia - tempMostrada;

    elemento("ro-t").textContent = formatear(tempMostrada, 1) + " °C";
    elemento("ro-sp").textContent = formatear(entrada.referencia, 1) + " °C";
    elemento("ro-e").textContent = formatearConSigno(error, 1) + " °C";
    elemento("ro-h").textContent = formatear(calefaccionMostrada, 0) + " %";
    elemento("ro-v").textContent = formatear(ventanasMostradas, 0) + " %";

    // Error medio de los últimos 10 minutos (muestra el error en estado estacionario)
    let suma = 0, cantidad = 0;
    for (let i = historia.tiempo.length - 1; i >= 0 && historia.tiempo[i] >= estado.tiempo - 10; i--) {
        suma += historia.referencia[i] - historia.salida[i];
        cantidad++;
    }
    if (cantidad > 0) {
        const errorMedio = suma / cantidad;
        elemento("ro-ess").textContent = formatearConSigno(errorMedio, 2) + " °C";
    } else {
        elemento("ro-ess").textContent = "–";
    }

    elemento("status-txt").textContent = (corriendo ? "Corriendo" : "En pausa") + " · t = " + reloj(estado.tiempo);
}

// ===== BUCLE EN TIEMPO REAL =====

// ===== GRÁFICOS =====
// lee una variable del CSS así los gráficos siguen al modo oscuro
function variableCSS(nombre) {
    return getComputedStyle(document.documentElement).getPropertyValue(nombre).trim();
}

function prepararLienzo(canvas) {
    const escala = window.devicePixelRatio || 1;
    const medidas = canvas.getBoundingClientRect();
    const anchoPx = Math.round(medidas.width * escala);
    const altoPx = Math.round(medidas.height * escala);
    if (canvas.width !== anchoPx || canvas.height !== altoPx) {
        canvas.width = anchoPx;
        canvas.height = altoPx;
    }
    const lapiz = canvas.getContext("2d");
    lapiz.setTransform(escala, 0, 0, escala, 0, 0);
    return {lapiz: lapiz, ancho: medidas.width, alto: medidas.height};
}

function pasoDeGrilla(rango, cantidadDeseada) {
    const bruto = rango / cantidadDeseada;
    const magnitud = Math.pow(10, Math.floor(Math.log10(bruto)));
    const relativo = bruto / magnitud;
    if (relativo < 1.5) return 1 * magnitud;
    if (relativo < 3) return 2 * magnitud;
    if (relativo < 7) return 5 * magnitud;
    return 10 * magnitud;
}

function dibujarGrafico(canvas, series, yMin, yMax) {
    const { lapiz, ancho, alto } = prepararLienzo(canvas);
    const margen = { izq: 44, der: 20, arriba: 10, abajo: 22 };
    const anchoUtil = ancho - margen.izq - margen.der;
    const altoUtil = alto - margen.arriba - margen.abajo;

    const tiempoFinal = Math.max(estado.tiempo, VENTANA);
    const tiempoInicial = tiempoFinal - VENTANA;

    // conversion de valores del sistema a pixeles de la pantalla
    const xDe = (tiempo) => margen.izq + (tiempo - tiempoInicial) / VENTANA * anchoUtil;
    const yDe = (valor) => margen.arriba + (1 - (valor - yMin) / (yMax - yMin)) * altoUtil;

    lapiz.clearRect(0, 0, ancho, alto);
    lapiz.font = "11px " + variableCSS("--font-data");
    lapiz.lineWidth = 1;
    lapiz.setLineDash([]);

    const paso = pasoDeGrilla(yMax - yMin, 5);
    lapiz.strokeStyle = variableCSS("--line");
    lapiz.fillStyle = variableCSS("--muted");
    lapiz.textAlign = "right";
    lapiz.textBaseline = "middle";
    for (let valor = Math.ceil(yMin / paso) * paso; valor <= yMax + 1e-9; valor += paso) {
        const y = Math.round(yDe(valor)) + 0.5;
        lapiz.beginPath();
        lapiz.moveTo(margen.izq, y);
        lapiz.lineTo(ancho - margen.der, y);
        lapiz.stroke();
        lapiz.fillText(formatear(valor, 0), margen.izq - 6, y);
    }

    // marcas del eje X (tiempo), cada 20 minutos
    lapiz.textAlign = "center";
    lapiz.textBaseline = "top";
    for (let tiempo = Math.ceil(tiempoInicial / 20) * 20; tiempo <= tiempoFinal + 1e-9; tiempo += 20) {
        const x = Math.round(xDe(tiempo)) + 0.5;
        lapiz.beginPath();
        lapiz.moveTo(x, margen.arriba + altoUtil);
        lapiz.lineTo(x, margen.arriba + altoUtil + 4);
        lapiz.stroke();
        lapiz.fillText(reloj(tiempo), x, margen.arriba + altoUtil + 6);
    }

    lapiz.save();
    lapiz.beginPath();
    lapiz.rect(margen.izq, margen.arriba, anchoUtil, altoUtil);
    lapiz.clip();   // nada se dibuja fuera del recuadro
    for (const serie of series) {
        const valores = historia[serie.dato];
        lapiz.strokeStyle = variableCSS(serie.color);
        lapiz.lineWidth = serie.grosor || 1.75;
        lapiz.setLineDash(serie.punteada ? [6, 4] : []);
        lapiz.beginPath();
        let primerPunto = true;
        for (let i = 0; i < valores.length; i++) {
        if (historia.tiempo[i] < tiempoInicial - 1) continue; // fuera de la ventana visible
        const x = xDe(historia.tiempo[i]);
        const y = yDe(valores[i]);
        if (primerPunto) { lapiz.moveTo(x, y); primerPunto = false; }
        else lapiz.lineTo(x, y);
        }
        lapiz.stroke();
    }
    lapiz.restore();

    lapiz.strokeStyle = variableCSS("--line");
    lapiz.strokeRect(margen.izq + 0.5, margen.arriba + 0.5, anchoUtil - 1, altoUtil - 1);

    const ahora = performance.now();
    if (ahora - ultimoRefrescoIndicadores >= 500) {
        actualizarIndicadores();
        ultimoRefrescoIndicadores = ahora;
    }
}

let ultimoRefrescoIndicadores = -Infinity;   // -Infinity: la primera vez se muestran enseguida

// calcula el rango del eje Y según los valores visibles, con un margen
function rangoVisible(datos, margenExtra, rangoMinimo) {
    const tiempoInicial = Math.max(estado.tiempo, VENTANA) - VENTANA;
    let minimo = Infinity, maximo = -Infinity;
    for (const dato of datos) {
        historia[dato].forEach(function (valor, i) {
        if (historia.tiempo[i] < tiempoInicial) return;
        minimo = Math.min(minimo, valor);
        maximo = Math.max(maximo, valor);
        });
    }
    if (!isFinite(minimo)) { minimo = 15; maximo = 25; }
    if (maximo - minimo < rangoMinimo) {
        const medio = (maximo + minimo) / 2;
        minimo = medio - rangoMinimo / 2;
        maximo = medio + rangoMinimo / 2;
    }
    return [Math.floor(minimo - margenExtra), Math.ceil(maximo + margenExtra)];
}

// dibuja los tres gráficos y actualiza los indicadores
function dibujarTodo() {
    const [tempMin, tempMax] = rangoVisible(["salida", "referencia", "tempExterior"], 1, 6);
    dibujarGrafico(elemento("c-temp"), [
        { dato: "tempExterior", color: "--t-out", grosor: 1.5 },
        { dato: "referencia", color: "--t-sp", grosor: 1.5, punteada: true },
        { dato: "salida", color: "--t-in", grosor: 2 }
    ], tempMin, tempMax);

    dibujarGrafico(elemento("c-act"), [
        { dato: "calefaccion", color: "--heat" },
        { dato: "ventanas", color: "--vent" }
    ], 0, 100);

    dibujarGrafico(elemento("c-dist"), [
        { dato: "radiacion", color: "--rad" }
    ], 0, 1000);

    actualizarIndicadores();
}

let corriendo = false;       // arranca en pausa
let instanteAnterior = null; // momento del cuadro anterior (ms)

function cuadro(instanteActual) {
    if (instanteAnterior === null) instanteAnterior = instanteActual;

    // tiempo real desde el cuadro anterior en segundos
    const segundosReales = Math.min(0.1, (instanteActual - instanteAnterior) / 1000);
    instanteAnterior = instanteActual;

    if (corriendo) {
        const velocidad = parseFloat(elemento("speed").value); // minutos simulados por segundo real
        avanzar(segundosReales * velocidad);
    }

    dibujarTodo();
    requestAnimationFrame(cuadro); // pide el próximo cuadro y así hay bucle
}


// ===== BOTONES =====
function ponerEnMarcha(valor) {
    corriendo = valor;

    const boton = elemento("btn-run");
    if (corriendo) boton.textContent = "Pausar";
    else if (estado.tiempo > 0) boton.textContent = "Continuar";
    else boton.textContent = "Iniciar";

    // la clase paused pone el punto naranja
    elemento("status").classList.toggle("paused", !corriendo);
    actualizarIndicadores();
}

//boton de iniciar/pausa
elemento("btn-run").addEventListener("click", function () {
    ponerEnMarcha(!corriendo);
});

elemento("btn-reset").addEventListener("click", function () {
    reiniciar();
    ponerEnMarcha(false); // después de reiniciar queda en pausa
});


// ===== INICIO =====
reiniciar();
dibujarTodo();
requestAnimationFrame(cuadro);