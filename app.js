const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { Translate } = require('@google-cloud/translate').v2;

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const translate = new Translate();

let usuarios = {};
let salas = {};

wss.on('connection', (ws) => {
    console.log('Cliente conectado');

    // Enviar historial de mensajes al cliente cuando se conecta a una sala
    ws.on('message', async (mensaje) => {
        let datos = null;
        try {
            datos = JSON.parse(mensaje);
        } catch (error) {
            console.error('JSON inválido', error);
            return;
        }

        switch (datos.tipo) {
            case 'unirseSala':
                if (salas[datos.sala]) {
                    ws.send(JSON.stringify({ tipo: 'historialMensajes', historial: salas[datos.sala].mensajes }));
                }
                break;
            case 'iniciarSesion':
                if (usuarios[datos.nombre]) {
                    enviarA(ws, { tipo: 'iniciarSesion', exito: false });
                } else {
                    usuarios[datos.nombre] = ws;
                    ws.nombre = datos.nombre;
                    ws.salas = [];
                    enviarA(ws, { tipo: 'iniciarSesion', exito: true });
                }
                break;
            case 'crearSala':
                if (salas[datos.sala]) {
                    enviarA(ws, { tipo: 'crearSala', exito: false });
                } else {
                    salas[datos.sala] = { usuarios: [ws], administradores: [ws.nombre], mensajes: [] };
                    ws.salas.push(datos.sala);
                    enviarA(ws, { tipo: 'crearSala', exito: true });
                }
                break;
            case 'mensaje':
                if (ws.salas.includes(datos.sala)) {
                    let sala = salas[datos.sala];
                    let mensaje = { tipo: 'mensaje', mensaje: datos.mensaje, de: ws.nombre };
                    sala.mensajes.push(mensaje);
                    let mensajeTraducido = await traducirTexto(datos.mensaje, 'es');
                    transmitir(sala, { tipo: 'mensaje', mensaje: mensajeTraducido, de: ws.nombre });
                }
                break;
            case 'eliminarMensaje':
                if (ws.salas.includes(datos.sala) && salas[datos.sala].administradores.includes(ws.nombre)) {
                    let sala = salas[datos.sala];
                    sala.mensajes = sala.mensajes.filter(mensaje => mensaje.mensaje !== datos.mensaje);
                    transmitir(sala, { tipo: 'eliminarMensaje', mensaje: datos.mensaje });
                }
                break;
            case 'nombrarAdministrador':
                if (ws.salas.includes(datos.sala) && salas[datos.sala].administradores.includes(ws.nombre)) {
                    let sala = salas[datos.sala];
                    if (sala.usuarios.some(usuario => usuario.nombre === datos.nuevoAdmin)) {
                        sala.administradores.push(datos.nuevoAdmin);
                        transmitir(sala, { tipo: 'mensaje', mensaje: `${ws.nombre} ha nombrado a ${datos.nuevoAdmin} como administrador`, de: 'servidor' });
                    }
                }
                break;
            case 'salirSala':
                if (ws.salas.includes(datos.sala)) {
                    let sala = salas[datos.sala];
                    let indice = sala.usuarios.indexOf(ws);
                    if (indice !== -1) {
                        sala.usuarios.splice(indice, 1);
                        ws.salas.splice(ws.salas.indexOf(datos.sala), 1);
                        transmitir(sala, { tipo: 'mensaje', mensaje: `${ws.nombre} ha abandonado la sala`, de: 'servidor' });
                    }
                }
                break;
        }
    });

    ws.on('close', () => {
        if (ws.nombre) {
            delete usuarios[ws.nombre];
            ws.salas.forEach(nombreSala => {
                let sala = salas[nombreSala];
                let indice = sala.usuarios.indexOf(ws);
                if (indice !== -1) {
                    sala.usuarios.splice(indice, 1);
                    transmitir(sala, { tipo: 'mensaje', mensaje: `${ws.nombre} ha abandonado la sala`, de: 'servidor' });
                }
            });
        }
    });
});

async function traducirTexto(texto, idiomaDestino) {
    let [traduccion] = await translate.translate(texto, idiomaDestino);
    return traduccion;
}

function enviarA(conexion, mensaje) {
    conexion.send(JSON.stringify(mensaje));
}

function transmitir(sala, mensaje) {
    sala.usuarios.forEach(usuario => enviarA(usuario, mensaje));
}

server.listen(8080, () => {
    console.log('El servidor está escuchando en el puerto 8080');
});

app.get('/', (req, res) => {
    res.send('¡Bienvenido a mi servidor de chat!');
});
