// server.js - Sistema de Reservas con MercadoPago

// ⚠️ IMPORTANTE: Esto DEBE ser lo primero
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');

// Configurar MercadoPago - SDK v2.x
const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');

// VERIFICAR que el token esté cargado
console.log('🔑 Verificando credenciales MercadoPago...');
console.log('MP_ACCESS_TOKEN:', process.env.MP_ACCESS_TOKEN ? 'CONFIGURADO ✅' : 'NO CONFIGURADO ❌');

// DEBUG - Ver variables cargadas
console.log('🔍 DEBUG Variables:');
console.log('   URL_BASE:', process.env.URL_BASE || 'NO DEFINIDA');
console.log('   PORT:', process.env.PORT || '3001 (default)');
console.log('   Token:', process.env.MP_ACCESS_TOKEN ? process.env.MP_ACCESS_TOKEN.substring(0, 25) + '...' : 'NO DEFINIDO');
console.log('---');

// Inicializar cliente de MercadoPago
let client = null;
let preference = null;

if (process.env.MP_ACCESS_TOKEN) {
    client = new MercadoPagoConfig({ 
        accessToken: process.env.MP_ACCESS_TOKEN,
        options: {
            timeout: 5000
        }
    });
    preference = new Preference(client);
    console.log('✅ Cliente MercadoPago inicializado correctamente');
} else {
    console.log('⚠️ MercadoPago NO configurado - Los pagos no funcionarán');
}

const app = express();
const PORT = process.env.PORT || 3001;

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.static('frontend'));

// Crear base de datos SQLite
const db = new sqlite3.Database('./reservas.db');

// Crear tablas si no existen
db.serialize(() => {
    // Tabla de servicios
    db.run(`CREATE TABLE IF NOT EXISTS servicios (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT NOT NULL,
        descripcion TEXT,
        precio REAL NOT NULL,
        duracion INTEGER NOT NULL,
        activo BOOLEAN DEFAULT 1
    )`);

    // Tabla de clientes
    db.run(`CREATE TABLE IF NOT EXISTS clientes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT NOT NULL,
        apellido TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        telefono TEXT NOT NULL,
        fecha_registro DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Tabla de reservas
    db.run(`CREATE TABLE IF NOT EXISTS reservas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cliente_id INTEGER,
        servicio_id INTEGER,
        fecha DATE NOT NULL,
        hora TIME NOT NULL,
        estado TEXT DEFAULT 'pendiente',
        porcentaje_pagado INTEGER DEFAULT 0,
        monto_pagado REAL DEFAULT 0,
        pago_id TEXT,
        notas TEXT,
        link_pago TEXT,
        fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (cliente_id) REFERENCES clientes (id),
        FOREIGN KEY (servicio_id) REFERENCES servicios (id)
    )`);

    // Tabla de administradores
    db.run(`CREATE TABLE IF NOT EXISTS admins (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL
    )`);

    // Crear admin por defecto
    const defaultPassword = bcrypt.hashSync('admin123', 10);
    db.run(`INSERT OR IGNORE INTO admins (username, password, email) 
            VALUES ('admin', '${defaultPassword}', 'admin@sistema.com')`);
    
    // Insertar servicios de ejemplo
    db.run(`INSERT OR IGNORE INTO servicios (id, nombre, descripcion, precio, duracion, activo) 
            VALUES (1, 'Corte de Cabello', 'Corte profesional con estilo', 50.00, 30, 1)`);
    
    db.run(`INSERT OR IGNORE INTO servicios (id, nombre, descripcion, precio, duracion, activo) 
            VALUES (2, 'Manicura', 'Manicura completa con esmaltado', 35.00, 45, 1)`);
    
    db.run(`INSERT OR IGNORE INTO servicios (id, nombre, descripcion, precio, duracion, activo) 
            VALUES (3, 'Masaje Relajante', 'Masaje de 1 hora', 80.00, 60, 1)`);
});

// ===================== FUNCIONES AUXILIARES =====================

function generarHorasDisponibles(horasOcupadas) {
    const todasLasHoras = [];
    for (let h = 9; h < 18; h++) {
        todasLasHoras.push(`${h}:00`);
        todasLasHoras.push(`${h}:30`);
    }
    return todasLasHoras.filter(hora => !horasOcupadas.includes(hora));
}

function verificarToken(req, res, next) {
    const token = req.headers['authorization'];
    if (!token) return res.status(403).json({ error: 'Token requerido' });
    
    jwt.verify(token, 'SECRET_KEY_CAMBIAR', (err, decoded) => {
        if (err) return res.status(401).json({ error: 'Token inválido' });
        req.userId = decoded.id;
        next();
    });
}

// ===================== RUTAS API PÚBLICAS =====================

// 1. OBTENER SERVICIOS DISPONIBLES
app.get('/api/servicios', (req, res) => {
    db.all('SELECT * FROM servicios WHERE activo = 1', (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// 2. VERIFICAR DISPONIBILIDAD
app.get('/api/disponibilidad/:fecha', (req, res) => {
    const { fecha } = req.params;
    
    db.all(
        'SELECT hora FROM reservas WHERE fecha = ? AND estado != "cancelada" AND estado != "pendiente_pago"',
        [fecha],
        (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            
            const horasOcupadas = rows.map(r => r.hora);
            const horasDisponibles = generarHorasDisponibles(horasOcupadas);
            
            res.json(horasDisponibles);
        }
    );
});

// 3. CREAR RESERVA CON LINK DE PAGO MERCADOPAGO
app.post('/api/reservas', async (req, res) => {
    const { nombre, apellido, email, telefono, servicio_id, fecha, hora, porcentaje_pago, notas } = req.body;
    
    console.log('\n=== NUEVA RESERVA ===');
    console.log('Cliente:', nombre, apellido);
    console.log('Email:', email);
    console.log('Servicio ID:', servicio_id);
    console.log('Fecha:', fecha, 'Hora:', hora);
    console.log('Porcentaje a pagar:', porcentaje_pago + '%');
    
    try {
        // Obtener servicio
        db.get('SELECT * FROM servicios WHERE id = ?', [servicio_id], async (err, servicio) => {
            if (err) {
                console.error('❌ Error BD:', err);
                return res.status(500).json({ error: err.message });
            }
            if (!servicio) {
                console.error('❌ Servicio no encontrado');
                return res.status(404).json({ error: 'Servicio no encontrado' });
            }
            
            const montoAPagar = Math.round((servicio.precio * porcentaje_pago) / 100 * 100) / 100;
            console.log('💰 Precio servicio:', servicio.precio);
            console.log('💰 Monto a pagar:', montoAPagar);
            
            // Crear o buscar cliente
            db.get('SELECT id FROM clientes WHERE email = ?', [email], async (err, cliente) => {
                const procesarReserva = async (clienteId) => {
                    // Crear reserva PENDIENTE DE PAGO
                    db.run(
                        `INSERT INTO reservas (cliente_id, servicio_id, fecha, hora, estado, porcentaje_pagado, monto_pagado, notas) 
                         VALUES (?, ?, ?, ?, 'pendiente_pago', ?, ?, ?)`,
                        [clienteId, servicio_id, fecha, hora, porcentaje_pago, montoAPagar, notas || ''],
                        async function(err) {
                            if (err) {
                                console.error('❌ Error creando reserva:', err);
                                return res.status(500).json({ error: err.message });
                            }
                            
                            const reservaId = this.lastID;
                            console.log('✅ Reserva creada con ID:', reservaId);
                            
                            // Verificar si MercadoPago está configurado
                            if (!preference) {
                                console.log('⚠️ MercadoPago no configurado, reserva sin link de pago');
                                return res.json({
                                    success: true,
                                    reservaId: reservaId,
                                    linkPago: null,
                                    mensaje: 'Reserva creada. MercadoPago no configurado.',
                                    servicio: servicio.nombre,
                                    fecha: fecha,
                                    hora: hora,
                                    monto: montoAPagar,
                                    error: 'MercadoPago no está configurado'
                                });
                            }
                            
                            // CREAR PREFERENCIA DE PAGO EN MERCADOPAGO
                            try {
                                console.log('\n💳 Creando preferencia en MercadoPago...');
                                
                                const preferenceData = {
    body: {
        items: [{
            id: `reserva-${reservaId}`,
            title: servicio.nombre,
            description: `Reserva para ${fecha} a las ${hora}`,
            quantity: 1,
            currency_id: 'ARS',
            unit_price: Number(montoAPagar)
        }],
        payer: {
            name: nombre,
            surname: apellido,
            email: email
        },
        back_urls: {
    success: `http://localhost:3001/pago/completado?reserva=${reservaId}`,
    failure: `http://localhost:3001/pago/error?reserva=${reservaId}`,
    pending: `http://localhost:3001/pago/pendiente?reserva=${reservaId}`
},
        external_reference: reservaId.toString()
    }
};
                                
                                console.log('📦 Enviando a MercadoPago...');
                                
                                const resultado = await preference.create(preferenceData);
                                
                                console.log('✅ Preferencia creada exitosamente!');
                                console.log('🔗 ID Preferencia:', resultado.id);
                                console.log('🔗 Link de pago:', resultado.init_point);
                                
                                // Guardar link en BD
                                db.run(
                                    'UPDATE reservas SET link_pago = ? WHERE id = ?',
                                    [resultado.init_point, reservaId]
                                );
                                
                                res.json({
                                    success: true,
                                    reservaId: reservaId,
                                    linkPago: resultado.init_point,
                                    mensaje: 'Reserva creada. Completa el pago para confirmar.',
                                    servicio: servicio.nombre,
                                    fecha: fecha,
                                    hora: hora,
                                    monto: montoAPagar
                                });
                                
                            } catch (mpError) {
                                console.error('\n❌ ERROR DE MERCADOPAGO:');
                                console.error('Nombre:', mpError.name);
                                console.error('Mensaje:', mpError.message);
                                
                                if (mpError.cause) {
                                    console.error('Causa:', JSON.stringify(mpError.cause, null, 2));
                                }
                                
                                // Si falla MP, igual devolver la reserva pero sin link
                                res.json({
                                    success: true,
                                    reservaId: reservaId,
                                    linkPago: null,
                                    mensaje: 'Reserva creada. Contacta para coordinar el pago.',
                                    servicio: servicio.nombre,
                                    fecha: fecha,
                                    hora: hora,
                                    monto: montoAPagar,
                                    error: mpError.message || 'Error al generar link de pago'
                                });
                            }
                        }
                    );
                };
                
                if (cliente) {
                    procesarReserva(cliente.id);
                } else {
                    // Crear nuevo cliente
                    db.run(
                        'INSERT INTO clientes (nombre, apellido, email, telefono) VALUES (?, ?, ?, ?)',
                        [nombre, apellido, email, telefono],
                        function(err) {
                            if (err) return res.status(500).json({ error: err.message });
                            procesarReserva(this.lastID);
                        }
                    );
                }
            });
        });
    } catch (error) {
        console.error('❌ Error general:', error);
        res.status(500).json({ error: 'Error al procesar la reserva' });
    }
});

// ===================== WEBHOOK DE MERCADOPAGO =====================

app.post('/webhook/mercadopago', async (req, res) => {
    console.log('\n=== WEBHOOK MERCADOPAGO ===');
    console.log('Body:', JSON.stringify(req.body, null, 2));
    
    try {
        const { type, data } = req.body;
        
        if (type === 'payment') {
            const paymentId = data.id;
            console.log('Payment ID:', paymentId);
            
            // Aquí podrías verificar el pago con la API de MercadoPago
            // Por ahora solo logueamos
        }
        
        res.status(200).send('OK');
    } catch (error) {
        console.error('Error en webhook:', error);
        res.status(500).send('Error');
    }
});

// ===================== RUTAS DE RETORNO DE MERCADOPAGO =====================

app.get('/pago/completado', (req, res) => {
    console.log('\n🎉 =======================================');
    console.log('    LLEGÓ A /pago/completado');
    console.log('=======================================');
    console.log('📦 Query params:', req.query);
    console.log('🔗 URL completa:', req.url);
    console.log('📍 IP origen:', req.ip);
    
    const { reserva, payment_id, status, external_reference } = req.query;
    
    if (!reservaId) {
        return res.redirect('/pago/error');
    }
    
    db.run(
        `UPDATE reservas SET estado = 'confirmada', pago_id = ? WHERE id = ?`,
        [payment_id || 'pagado', reservaId],
        function(err) {
            if (err) console.error('Error actualizando reserva:', err);
            
            db.get(`
                SELECT r.*, c.nombre, c.apellido, c.email, c.telefono, s.nombre as servicio_nombre, s.precio
                FROM reservas r
                JOIN clientes c ON r.cliente_id = c.id
                JOIN servicios s ON r.servicio_id = s.id
                WHERE r.id = ?
            `, [reservaId], (err, reserva) => {
                
                const montoPendiente = reserva ? (reserva.precio - reserva.monto_pagado) : 0;
                
                res.send(`
                    <!DOCTYPE html>
                    <html lang="es">
                    <head>
                        <meta charset="UTF-8">
                        <meta name="viewport" content="width=device-width, initial-scale=1.0">
                        <title>¡Reserva Confirmada!</title>
                        <style>
                            * { margin: 0; padding: 0; box-sizing: border-box; }
                            body {
                                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                                min-height: 100vh;
                                display: flex;
                                align-items: center;
                                justify-content: center;
                                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                                padding: 20px;
                            }
                            .container {
                                background: white;
                                padding: 50px;
                                border-radius: 20px;
                                text-align: center;
                                max-width: 500px;
                                width: 100%;
                                box-shadow: 0 20px 60px rgba(0,0,0,0.3);
                                animation: appear 0.6s ease-out;
                            }
                            @keyframes appear {
                                from { opacity: 0; transform: scale(0.9) translateY(20px); }
                                to { opacity: 1; transform: scale(1) translateY(0); }
                            }
                            .check {
                                width: 100px;
                                height: 100px;
                                background: linear-gradient(135deg, #4CAF50, #45a049);
                                border-radius: 50%;
                                display: flex;
                                align-items: center;
                                justify-content: center;
                                margin: 0 auto 25px;
                                font-size: 50px;
                                color: white;
                                animation: pop 0.5s ease-out 0.3s both;
                            }
                            @keyframes pop {
                                from { transform: scale(0); }
                                to { transform: scale(1); }
                            }
                            h1 { color: #333; margin-bottom: 10px; font-size: 28px; }
                            .subtitle { color: #666; margin-bottom: 30px; font-size: 16px; }
                            .details {
                                background: #f8f9fa;
                                padding: 25px;
                                border-radius: 12px;
                                text-align: left;
                                margin-bottom: 25px;
                            }
                            .detail-row {
                                display: flex;
                                justify-content: space-between;
                                padding: 12px 0;
                                border-bottom: 1px solid #eee;
                            }
                            .detail-row:last-child { border-bottom: none; }
                            .detail-label { color: #666; }
                            .detail-value { font-weight: 600; color: #333; }
                            .badge {
                                display: inline-block;
                                background: #4CAF50;
                                color: white;
                                padding: 8px 20px;
                                border-radius: 25px;
                                font-weight: 500;
                                margin-bottom: 20px;
                            }
                            .note {
                                background: #e8f5e9;
                                padding: 20px;
                                border-radius: 8px;
                                color: #2e7d32;
                                font-size: 14px;
                                margin-bottom: 25px;
                            }
                            .warning {
                                background: #fff3cd;
                                padding: 20px;
                                border-radius: 8px;
                                color: #856404;
                                font-size: 14px;
                                margin-bottom: 25px;
                            }
                            .btn {
                                display: inline-block;
                                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                                color: white;
                                padding: 15px 35px;
                                text-decoration: none;
                                border-radius: 8px;
                                font-weight: 500;
                                transition: transform 0.3s;
                                margin: 5px;
                            }
                            .btn:hover { transform: translateY(-2px); }
                            .whatsapp-btn {
                                background: #25D366;
                            }
                        </style>
                    </head>
                    <body>
                        <div class="container">
                            <div class="check">✓</div>
                            <h1>¡Reserva Confirmada!</h1>
                            <p class="subtitle">Tu pago fue procesado exitosamente</p>
                            
                            <span class="badge">Reserva #${reservaId}</span>
                            
                            ${reserva ? `
                            <div class="details">
                                <div class="detail-row">
                                    <span class="detail-label">👤 Cliente</span>
                                    <span class="detail-value">${reserva.nombre} ${reserva.apellido}</span>
                                </div>
                                <div class="detail-row">
                                    <span class="detail-label">📅 Fecha</span>
                                    <span class="detail-value">${reserva.fecha}</span>
                                </div>
                                <div class="detail-row">
                                    <span class="detail-label">🕐 Hora</span>
                                    <span class="detail-value">${reserva.hora}</span>
                                </div>
                                <div class="detail-row">
                                    <span class="detail-label">💇 Servicio</span>
                                    <span class="detail-value">${reserva.servicio_nombre}</span>
                                </div>
                                <div class="detail-row">
                                    <span class="detail-label">💰 Pagado</span>
                                    <span class="detail-value">${reserva.porcentaje_pagado}% - $${reserva.monto_pagado.toFixed(2)}</span>
                                </div>
                                ${montoPendiente > 0 ? `
                                <div class="detail-row">
                                    <span class="detail-label">⏳ Pendiente</span>
                                    <span class="detail-value" style="color: #f44336;">$${montoPendiente.toFixed(2)}</span>
                                </div>
                                ` : ''}
                            </div>
                            
                            ${montoPendiente > 0 ? `
                            <div class="warning">
                                💵 Recuerda traer $${montoPendiente.toFixed(2)} restantes el día de tu cita.
                            </div>
                            ` : ''}
                            ` : ''}
                            
                            <div class="note">
                                📧 Te enviamos los detalles por email<br>
                                📱 ¡Te esperamos! No olvides tu cita
                            </div>
                            
                            ${process.env.TELEFONO_NEGOCIO ? `
                            <a href="https://wa.me/${process.env.TELEFONO_NEGOCIO}?text=Hola!%20Acabo%20de%20confirmar%20mi%20reserva%20%23${reservaId}" 
                               class="btn whatsapp-btn" target="_blank">
                                📱 WhatsApp
                            </a>
                            ` : ''}
                            
                            <a href="/widget" class="btn">Nueva reserva</a>
                        </div>
                    </body>
                    </html>
                `);
            });
        }
    );
});

app.get('/pago/error', (req, res) => {
    const { reserva } = req.query;
    if (reserva) {
        db.run('UPDATE reservas SET estado = "pago_fallido" WHERE id = ?', [reserva]);
    }
    res.send(`
        <!DOCTYPE html>
        <html lang="es">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Error en el pago</title>
            <style>
                * { margin: 0; padding: 0; box-sizing: border-box; }
                body {
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                    min-height: 100vh;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background: #f5f5f5;
                    padding: 20px;
                }
                .container {
                    background: white;
                    padding: 50px;
                    border-radius: 20px;
                    text-align: center;
                    max-width: 400px;
                    box-shadow: 0 10px 40px rgba(0,0,0,0.1);
                }
                .icon { font-size: 70px; margin-bottom: 20px; }
                h1 { color: #f44336; margin-bottom: 15px; }
                p { color: #666; margin-bottom: 25px; }
                .btn {
                    display: inline-block;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    color: white;
                    padding: 12px 30px;
                    text-decoration: none;
                    border-radius: 8px;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="icon">❌</div>
                <h1>Error en el pago</h1>
                <p>No pudimos procesar tu pago. Por favor intenta nuevamente.</p>
                <a href="/widget" class="btn">Intentar de nuevo</a>
            </div>
        </body>
        </html>
    `);
});

app.get('/pago/pendiente', (req, res) => {
    const { reserva } = req.query;
    res.send(`
        <!DOCTYPE html>
        <html lang="es">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Pago pendiente</title>
            <style>
                * { margin: 0; padding: 0; box-sizing: border-box; }
                body {
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                    min-height: 100vh;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background: #fff8e1;
                    padding: 20px;
                }
                .container {
                    background: white;
                    padding: 50px;
                    border-radius: 20px;
                    text-align: center;
                    max-width: 400px;
                }
                .icon { font-size: 70px; margin-bottom: 20px; }
                h1 { color: #FF9800; margin-bottom: 15px; }
                p { color: #666; margin-bottom: 25px; }
                .btn {
                    display: inline-block;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    color: white;
                    padding: 12px 30px;
                    text-decoration: none;
                    border-radius: 8px;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="icon">⏳</div>
                <h1>Pago pendiente</h1>
                <p>Tu pago está siendo procesado. Te notificaremos cuando esté confirmado.</p>
                ${reserva ? `<p style="color: #999; font-size: 14px;">Reserva #${reserva}</p>` : ''}
                <a href="/widget" class="btn">Volver al inicio</a>
            </div>
        </body>
        </html>
    `);
});

// ===================== RUTAS DE ADMIN =====================

app.post('/api/admin/login', (req, res) => {
    const { username, password } = req.body;
    db.get('SELECT * FROM admins WHERE username = ?', [username], (err, admin) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!admin) return res.status(401).json({ error: 'Usuario no encontrado' });
        if (!bcrypt.compareSync(password, admin.password)) {
            return res.status(401).json({ error: 'Contraseña incorrecta' });
        }
        const token = jwt.sign({ id: admin.id, username: admin.username }, 'SECRET_KEY_CAMBIAR', { expiresIn: '24h' });
        res.json({ token, username: admin.username });
    });
});

app.get('/api/admin/reservas', verificarToken, (req, res) => {
    db.all(`
        SELECT r.*, c.nombre, c.apellido, c.email, c.telefono, s.nombre as servicio_nombre 
        FROM reservas r 
        JOIN clientes c ON r.cliente_id = c.id 
        JOIN servicios s ON r.servicio_id = s.id 
        ORDER BY r.fecha DESC, r.hora DESC
    `, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.get('/api/admin/estadisticas', verificarToken, (req, res) => {
    const stats = {};
    db.get('SELECT COUNT(*) as total FROM reservas', (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        stats.totalReservas = row.total;
        db.get('SELECT COUNT(*) as total FROM clientes', (err, row) => {
            if (err) return res.status(500).json({ error: err.message });
            stats.totalClientes = row.total;
            db.get('SELECT SUM(monto_pagado) as total FROM reservas WHERE estado = "confirmada"', (err, row) => {
                if (err) return res.status(500).json({ error: err.message });
                stats.ingresosTotales = row.total || 0;
                res.json(stats);
            });
        });
    });
});

app.post('/api/admin/servicios', verificarToken, (req, res) => {
    const { nombre, descripcion, precio, duracion } = req.body;
    db.run('INSERT INTO servicios (nombre, descripcion, precio, duracion, activo) VALUES (?, ?, ?, ?, 1)', 
        [nombre, descripcion, precio, duracion], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ id: this.lastID, mensaje: 'Servicio creado exitosamente' });
    });
});

app.put('/api/admin/servicios/:id', verificarToken, (req, res) => {
    const { id } = req.params;
    const { nombre, descripcion, precio, duracion, activo } = req.body;
    db.run('UPDATE servicios SET nombre = ?, descripcion = ?, precio = ?, duracion = ?, activo = ? WHERE id = ?', 
        [nombre, descripcion, precio, duracion, activo, id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ mensaje: 'Servicio actualizado exitosamente' });
    });
});

app.delete('/api/admin/servicios/:id', verificarToken, (req, res) => {
    const { id } = req.params;
    db.run('UPDATE servicios SET activo = 0 WHERE id = ?', [id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ mensaje: 'Servicio eliminado exitosamente' });
    });
});

app.get('/api/admin/servicios/:id', verificarToken, (req, res) => {
    const { id } = req.params;
    db.get('SELECT * FROM servicios WHERE id = ?', [id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: 'Servicio no encontrado' });
        res.json(row);
    });
});

app.get('/api/admin/servicios', verificarToken, (req, res) => {
    db.all('SELECT * FROM servicios ORDER BY activo DESC, nombre ASC', (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.get('/api/admin/clientes', verificarToken, (req, res) => {
    db.all(`
        SELECT c.*, COUNT(r.id) as total_reservas 
        FROM clientes c 
        LEFT JOIN reservas r ON c.id = r.cliente_id 
        GROUP BY c.id 
        ORDER BY c.fecha_registro DESC
    `, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.put('/api/admin/reservas/:id/estado', verificarToken, (req, res) => {
    const { id } = req.params;
    const { estado } = req.body;
    db.run('UPDATE reservas SET estado = ? WHERE id = ?', [estado, id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ mensaje: 'Estado actualizado exitosamente' });
    });
});

app.put('/api/admin/cambiar-password', verificarToken, (req, res) => {
    const { passwordActual, passwordNueva } = req.body;
    db.get('SELECT * FROM admins WHERE id = ?', [req.userId], (err, admin) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!admin) return res.status(404).json({ error: 'Usuario no encontrado' });
        if (!bcrypt.compareSync(passwordActual, admin.password)) {
            return res.status(401).json({ error: 'Contraseña actual incorrecta' });
        }
        const nuevaPasswordHash = bcrypt.hashSync(passwordNueva, 10);
        db.run('UPDATE admins SET password = ? WHERE id = ?', [nuevaPasswordHash, req.userId], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ mensaje: 'Contraseña actualizada exitosamente' });
        });
    });
});

app.put('/api/admin/perfil', verificarToken, (req, res) => {
    const { username, email } = req.body;
    db.get('SELECT id FROM admins WHERE (username = ? OR email = ?) AND id != ?', 
        [username, email, req.userId], (err, existente) => {
        if (err) return res.status(500).json({ error: err.message });
        if (existente) {
            return res.status(400).json({ error: 'El usuario o email ya existe' });
        }
        db.run('UPDATE admins SET username = ?, email = ? WHERE id = ?', 
            [username, email, req.userId], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ mensaje: 'Perfil actualizado exitosamente' });
        });
    });
});

app.get('/api/admin/perfil', verificarToken, (req, res) => {
    db.get('SELECT id, username, email FROM admins WHERE id = ?', [req.userId], (err, admin) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!admin) return res.status(404).json({ error: 'Usuario no encontrado' });
        res.json(admin);
    });
});

// ===================== RUTAS DE PÁGINAS =====================

app.get('/', (req, res) => {
    const mpStatus = process.env.MP_ACCESS_TOKEN ? '✅ Configurado' : '❌ No configurado';
    res.send(`
        <!DOCTYPE html>
        <html lang="es">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>${process.env.NOMBRE_NEGOCIO || 'Sistema de Reservas'}</title>
            <style>
                body {
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                    margin: 0;
                    padding: 0;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    min-height: 100vh;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }
                .container {
                    text-align: center;
                    color: white;
                    padding: 40px;
                }
                h1 { font-size: 48px; margin-bottom: 20px; }
                p { font-size: 20px; opacity: 0.9; margin-bottom: 40px; }
                .buttons {
                    display: flex;
                    gap: 20px;
                    justify-content: center;
                    flex-wrap: wrap;
                }
                a {
                    display: inline-block;
                    background: white;
                    color: #667eea;
                    padding: 15px 30px;
                    text-decoration: none;
                    border-radius: 8px;
                    font-weight: 600;
                    transition: transform 0.3s;
                }
                a:hover { transform: translateY(-2px); }
                .status {
                    background: rgba(255,255,255,0.1);
                    padding: 20px;
                    border-radius: 10px;
                    margin-top: 40px;
                }
                .mp-status {
                    margin-top: 10px;
                    font-size: 14px;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>🎯 ${process.env.NOMBRE_NEGOCIO || 'Sistema de Reservas'}</h1>
                <p>Sistema profesional con pagos integrados</p>
                <div class="buttons">
                    <a href="/widget">📅 Hacer Reserva</a>
                    <a href="/admin">🔐 Panel Admin</a>
                    <a href="/api/servicios">📋 Ver Servicios</a>
                </div>
                <div class="status">
                    <p>✅ Sistema funcionando correctamente</p>
                    <p class="mp-status">💳 MercadoPago: ${mpStatus}</p>
                    <small>Usuario admin: admin / Contraseña: admin123</small>
                </div>
            </div>
        </body>
        </html>
    `);
});

app.get('/widget', (req, res) => {
    res.sendFile(path.join(__dirname, 'frontend', 'widget.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'frontend', 'admin.html'));
});

// ===================== INICIAR SERVIDOR =====================

app.listen(PORT, () => {
    console.log(`
    ╔════════════════════════════════════════════════╗
    ║                                                ║
    ║   🚀 ${process.env.NOMBRE_NEGOCIO || 'SISTEMA DE RESERVAS'} v1.0
    ║                                                ║
    ║   ✅ Servidor funcionando                     ║
    ║   📍 URL: http://localhost:${PORT}              ║
    ║                                                ║
    ║   🔗 Accesos directos:                        ║
    ║   📅 Widget: http://localhost:${PORT}/widget        ║
    ║   🔐 Admin:  http://localhost:${PORT}/admin         ║
    ║                                                ║
    ║   👤 Credenciales admin:                      ║
    ║   Usuario: admin                              ║
    ║   Clave: admin123                             ║
    ║                                                ║
    ╚════════════════════════════════════════════════╝
    
    💳 MercadoPago: ${process.env.MP_ACCESS_TOKEN ? 'CONFIGURADO ✅' : 'NO CONFIGURADO ❌'}
    📞 WhatsApp: ${process.env.TELEFONO_NEGOCIO || 'No configurado'}
    `);
});

module.exports = app;