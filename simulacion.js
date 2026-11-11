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
let historia;                 // valores pasados, para los gráficos
let proximoRegistro;          // tiempo en que se guarda el próximo punto
let eventos;                  // cambios de referencia y perturbaciones para marcarlos en los gráficos
let perturbacionesTemporales; // pico de sol y puerta abierta

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
        salida: 20,                  // medición con ruido: la salida del sistema (°C)
        radiacionEfectiva: 150      // radiación que llega de verdad (slider + pico de sol)
    };

    historia = {
        tiempo: [], salida: [], referencia: [], tempExterior: [],
        calefaccion: [], ventanas: [], radiacion: []
    };
    proximoRegistro = 0;
    eventos = [];
    perturbacionesTemporales = [];
    mostrarRegistro();
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
        ? (parametros.gananciaSol * estado.radiacionEfectiva) / parametros.gananciaCalefaccion
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

    // --- Perturbaciones temporales activas en el momento ---
    let solExtra = 0;
    let perdidaPuertaAhora = 0;
    for (const perturbacion of perturbacionesTemporales) {
        const activa = estado.tiempo >= perturbacion.inicio && estado.tiempo < perturbacion.fin;
        if (!activa) continue;
        if (perturbacion.tipo === "sol") solExtra = Math.max(solExtra, perturbacion.valor);
        if (perturbacion.tipo === "puerta") perdidaPuertaAhora = p.perdidaPuerta;
    }
    estado.radiacionEfectiva = Math.min(1000, entrada.radiacion + solExtra);

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
    const perdidas = 1 + p.perdidaVentanas * aperturaVentanas * (1 + 0.15 * viento) + 0.03 * viento + perdidaPuertaAhora;
    const calorQueSale = perdidas * (estado.tempReal - entrada.tempExterior);
    const calorCalefaccion = p.gananciaCalefaccion * estado.potenciaCalefaccion;
    const calorSol = p.gananciaSol * estado.radiacionEfectiva;
    const velocidadDeCambio = (calorCalefaccion + calorSol - calorQueSale) / p.constanteTiempo;

    estado.tempReal += PASO * velocidadDeCambio; // método de Euler

    // guarda para despues mostrar
    estado.ordenCalefaccion = ordenCalefaccion;
    estado.aperturaVentanas = aperturaVentanas;
    estado.tiempo += PASO;
    registrarHistoria();
    
    // las perturbaciones que ya terminaron se borran de la lista
    perturbacionesTemporales = perturbacionesTemporales.filter((perturbacion) => perturbacion.fin > estado.tiempo);
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
    historia.radiacion.push(estado.radiacionEfectiva);
    
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

// ===== REGISTRO DE EVENTOS =====

function registrarEvento(texto) {
    eventos.push({ tiempo: estado.tiempo, texto: texto });
    mostrarRegistro();
}

// para mostrar los últimos 12 eventos en la lista de la página, del más nuevo al más viejo
function mostrarRegistro() {
    const lista = elemento("log");
    lista.innerHTML = "";
    if (eventos.length === 0) {
        lista.innerHTML = '<li class="empty">Todavía no hay eventos. Cambiá la entrada o agregá una perturbación.</li>';
        return;
    }
    const ultimos = eventos.slice(-12).reverse();
    for (const evento of ultimos) {
        const fila = document.createElement("li");
        const hora = document.createElement("span");
        hora.className = "t";
        hora.textContent = reloj(evento.tiempo);
        const descripcion = document.createElement("span");
        descripcion.textContent = evento.texto;
        fila.appendChild(hora);
        fila.appendChild(descripcion);
        lista.appendChild(fila);
    }
}

// ===== VALOR DE REFERENCIA =====

function mostrarReferencia() {
    elemento("sp-val").textContent = formatear(entrada.referencia, 1) + " °C";
    elemento("sp").value = entrada.referencia;
    actualizarIndicadores();
}

// cambia la referencia y lo anota como evento
function cambiarReferencia(nuevoValor) {
    nuevoValor = limitar(Math.round(nuevoValor * 2) / 2, 10, 30);
    if (nuevoValor === entrada.referencia) return;
    entrada.referencia = nuevoValor;
    mostrarReferencia();
    registrarEvento("Referencia → " + formatear(nuevoValor, 1) + " °C");
}

// mientras se arrastra el slider cambia el valor; al soltarlo se anota el evento
elemento("sp").addEventListener("input", function () {
    entrada.referencia = parseFloat(elemento("sp").value);
    mostrarReferencia();
});
elemento("sp").addEventListener("change", function () {
    registrarEvento("Referencia → " + formatear(entrada.referencia, 1) + " °C");
});

// botones −1 y +1
elemento("sp-up").addEventListener("click", function () { cambiarReferencia(entrada.referencia + 1); });
elemento("sp-down").addEventListener("click", function () { cambiarReferencia(entrada.referencia - 1); });


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

function dibujarGrafico(canvas, series, yMin, yMax, conEtiquetas) {
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

    // una línea vertical punteada en el momento en que ocurre cada evento
    lapiz.strokeStyle = variableCSS("--event");
    lapiz.setLineDash([3, 3]);
    for (const evento of eventos) {
        if (evento.tiempo < tiempoInicial) continue;
        const x = Math.round(xDe(evento.tiempo)) + 0.5;
        lapiz.beginPath();
        lapiz.moveTo(x, margen.arriba);
        lapiz.lineTo(x, margen.arriba + altoUtil);
        lapiz.stroke();
    }
    lapiz.setLineDash([]);

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

    // nombra cada evento al lado de su línea
    if (conEtiquetas) {
        lapiz.fillStyle = variableCSS("--event");
        lapiz.font = "600 11px " + variableCSS("--font-ui");
        lapiz.textBaseline = "top";
        let xAnterior = -Infinity, fila = 0;
        for (const evento of eventos) {
            if (evento.tiempo < tiempoInicial) continue;
            let x = xDe(evento.tiempo) + 4;
            fila = (x - xAnterior < 110) ? (fila + 1) % 3 : 0; // si está muy cerca del anterior, baja una fila
            xAnterior = x;
            const texto = evento.texto.length > 22 ? evento.texto.slice(0, 21) + "…" : evento.texto;
            if (x + lapiz.measureText(texto).width > ancho - margen.der) {
                lapiz.textAlign = "right"; // si no entra a la derecha, se escribe a la izquierda de la línea
                x -= 8;
            } else {
                lapiz.textAlign = "left";
            }
            lapiz.fillText(texto, x, margen.arriba + 2 + fila * 14);
        }
    }

    lapiz.strokeStyle = variableCSS("--line");
    lapiz.strokeRect(margen.izq + 0.5, margen.arriba + 0.5, anchoUtil - 1, altoUtil - 1);
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
    ], tempMin, tempMax, true);

    dibujarGrafico(elemento("c-act"), [
        { dato: "calefaccion", color: "--heat" },
        { dato: "ventanas", color: "--vent" }
    ], 0, 100);

    dibujarGrafico(elemento("c-dist"), [
        { dato: "radiacion", color: "--rad" }
    ], 0, 1000);

    // los indicadores se refrescan 2 veces por segundo
    const ahora = performance.now();
    if (ahora - ultimoRefrescoIndicadores >= 500) {
        actualizarIndicadores();
        ultimoRefrescoIndicadores = ahora;
    }
}


// ===== PERTURBACIONES =====

// conecta un slider con un valor de "entrada": lo muestra al lado y anota el evento al soltarlo
function conectarSlider(id, clave, unidad, decimales, nombreEvento) {
    const slider = elemento(id);
    const texto = elemento(id + "-val");
    function mostrar() {
        texto.textContent = formatear(entrada[clave], decimales) + unidad;
    }
    slider.addEventListener("input", function () {
        entrada[clave] = parseFloat(slider.value);
        mostrar();
    });
    slider.addEventListener("change", function () {
        registrarEvento(nombreEvento + " → " + formatear(entrada[clave], decimales) + unidad);
    });
    entrada[clave] = parseFloat(slider.value);   // al abrir la página, toma el valor inicial del HTML
    mostrar();
}

conectarSlider("text", "tempExterior", " °C", 1, "T exterior");
conectarSlider("rad", "radiacion", " W/m²", 0, "Radiación");
conectarSlider("wind", "viento", " m/s", 1, "Viento");

// pico de sol: +700 W/m² durante 20 minutos (perturbación externa temporal)
elemento("ev-sun").addEventListener("click", function () {
    perturbacionesTemporales.push({ tipo: "sol", inicio: estado.tiempo, fin: estado.tiempo + 20, valor: 700 });
    registrarEvento("Pico de sol (+700 W/m²)");
});

// frente frío: la temperatura exterior baja 8 °C de golpe (perturbación externa en escalón)
elemento("ev-cold").addEventListener("click", function () {
    entrada.tempExterior = Math.max(-10, entrada.tempExterior - 8);
    elemento("text").value = entrada.tempExterior;
    elemento("text-val").textContent = formatear(entrada.tempExterior, 1) + " °C";
    registrarEvento("Frente frío: T ext → " + formatear(entrada.tempExterior, 1) + " °C");
});

// puerta abierta: se escapa calor durante 5 minutos (perturbación interna temporal)
elemento("ev-door").addEventListener("click", function () {
    perturbacionesTemporales.push({ tipo: "puerta", inicio: estado.tiempo, fin: estado.tiempo + 5 });
    registrarEvento("Puerta abierta 5 min");
});

// lluvia: las ventanas no pueden abrir más del 10 % (para proteger el cultivo)
elemento("ev-rain").addEventListener("click", function () {
    entrada.lluvia = !entrada.lluvia;
    const boton = elemento("ev-rain");
    boton.textContent = "Lluvia: " + (entrada.lluvia ? "sí" : "no");
    boton.setAttribute("aria-pressed", entrada.lluvia);
    registrarEvento(entrada.lluvia ? "Empieza a llover" : "Para de llover");
});


// ===== BUCLE EN TIEMPO REAL =====

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
mostrarReferencia();
dibujarTodo();
requestAnimationFrame(cuadro);