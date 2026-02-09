// embed.js - Script para embeber el widget en cualquier sitio web

(function() {
    // Configuración del widget
    const WIDGET_SERVER = 'http://localhost:3001'; // CAMBIAR en producción
    
    // Estilos del botón flotante
    const buttonStyles = `
        .reservas-widget-button {
            position: fixed;
            bottom: 30px;
            right: 30px;
            width: 60px;
            height: 60px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            border-radius: 50%;
            box-shadow: 0 4px 20px rgba(0,0,0,0.3);
            cursor: pointer;
            z-index: 999998;
            transition: all 0.3s ease;
            border: none;
            color: white;
            font-size: 28px;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        
        .reservas-widget-button:hover {
            transform: scale(1.1);
            box-shadow: 0 6px 30px rgba(0,0,0,0.4);
        }
        
        .reservas-widget-button.active {
            background: #f44336;
            transform: rotate(45deg);
        }
        
        .reservas-widget-iframe-container {
            position: fixed;
            bottom: 100px;
            right: 30px;
            width: 400px;
            height: 600px;
            max-height: 80vh;
            background: white;
            border-radius: 20px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.3);
            z-index: 999997;
            display: none;
            animation: slideUp 0.3s ease-out;
        }
        
        .reservas-widget-iframe-container.active {
            display: block;
        }
        
        @keyframes slideUp {
            from {
                opacity: 0;
                transform: translateY(30px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }
        
        .reservas-widget-iframe {
            width: 100%;
            height: 100%;
            border: none;
            border-radius: 20px;
        }
        
        .reservas-widget-header {
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 50px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            border-radius: 20px 20px 0 0;
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 0 20px;
            color: white;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }
        
        .reservas-widget-title {
            font-weight: 600;
            font-size: 16px;
        }
        
        .reservas-widget-close {
            background: none;
            border: none;
            color: white;
            font-size: 24px;
            cursor: pointer;
            padding: 0;
            width: 30px;
            height: 30px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 50%;
            transition: background 0.3s ease;
        }
        
        .reservas-widget-close:hover {
            background: rgba(255,255,255,0.2);
        }
        
        .reservas-widget-body {
            position: absolute;
            top: 50px;
            left: 0;
            right: 0;
            bottom: 0;
            border-radius: 0 0 20px 20px;
            overflow: hidden;
        }
        
        /* Responsive */
        @media (max-width: 768px) {
            .reservas-widget-iframe-container {
                width: calc(100% - 20px);
                height: calc(100% - 100px);
                max-height: none;
                bottom: 10px;
                right: 10px;
                left: 10px;
            }
            
            .reservas-widget-button {
                bottom: 20px;
                right: 20px;
            }
        }
        
        /* Modo popup centrado (opcional) */
        .reservas-widget-modal {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0,0,0,0.5);
            z-index: 999996;
            display: none;
            align-items: center;
            justify-content: center;
        }
        
        .reservas-widget-modal.active {
            display: flex;
        }
        
        .reservas-widget-modal-content {
            width: 90%;
            max-width: 500px;
            height: 90%;
            max-height: 700px;
            background: white;
            border-radius: 20px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            position: relative;
            animation: modalIn 0.3s ease-out;
        }
        
        @keyframes modalIn {
            from {
                opacity: 0;
                transform: scale(0.9);
            }
            to {
                opacity: 1;
                transform: scale(1);
            }
        }
    `;
    
    // Inyectar estilos
    function injectStyles() {
        const styleSheet = document.createElement('style');
        styleSheet.textContent = buttonStyles;
        document.head.appendChild(styleSheet);
    }
    
    // Crear el widget
    function createWidget(config = {}) {
        // Configuración predeterminada
        const settings = {
            mode: config.mode || 'floating', // 'floating', 'inline', 'modal'
            position: config.position || 'bottom-right',
            buttonText: config.buttonText || '📅',
            title: config.title || 'Reservar Cita',
            primaryColor: config.primaryColor || '#667eea',
            secondaryColor: config.secondaryColor || '#764ba2',
            containerId: config.containerId || null,
            autoOpen: config.autoOpen || false,
            ...config
        };
        
        // Modo inline (embebido en un div específico)
        if (settings.mode === 'inline' && settings.containerId) {
            const container = document.getElementById(settings.containerId);
            if (container) {
                container.innerHTML = `
                    <iframe 
                        src="${WIDGET_SERVER}/widget" 
                        style="width: 100%; height: ${settings.height || '700px'}; border: none; border-radius: 10px;"
                        title="Sistema de Reservas"
                    ></iframe>
                `;
            }
            return;
        }
        
        // Modo floating o modal
        if (settings.mode === 'floating' || settings.mode === 'modal') {
            // Crear botón flotante
            const button = document.createElement('button');
            button.className = 'reservas-widget-button';
            button.innerHTML = settings.buttonText;
            button.setAttribute('aria-label', 'Abrir sistema de reservas');
            
            // Crear contenedor del iframe
            const iframeContainer = document.createElement('div');
            iframeContainer.className = settings.mode === 'modal' ? 
                'reservas-widget-modal' : 
                'reservas-widget-iframe-container';
            
            if (settings.mode === 'modal') {
                iframeContainer.innerHTML = `
                    <div class="reservas-widget-modal-content">
                        <div class="reservas-widget-header">
                            <span class="reservas-widget-title">${settings.title}</span>
                            <button class="reservas-widget-close" aria-label="Cerrar">×</button>
                        </div>
                        <div class="reservas-widget-body">
                            <iframe 
                                class="reservas-widget-iframe" 
                                src="${WIDGET_SERVER}/widget"
                                title="Sistema de Reservas"
                            ></iframe>
                        </div>
                    </div>
                `;
            } else {
                iframeContainer.innerHTML = `
                    <div class="reservas-widget-header">
                        <span class="reservas-widget-title">${settings.title}</span>
                        <button class="reservas-widget-close" aria-label="Cerrar">×</button>
                    </div>
                    <div class="reservas-widget-body">
                        <iframe 
                            class="reservas-widget-iframe" 
                            src="${WIDGET_SERVER}/widget"
                            title="Sistema de Reservas"
                        ></iframe>
                    </div>
                `;
            }
            
            // Agregar al DOM
            document.body.appendChild(button);
            document.body.appendChild(iframeContainer);
            
            // Event listeners
            button.addEventListener('click', function() {
                const isActive = iframeContainer.classList.contains('active');
                if (isActive) {
                    iframeContainer.classList.remove('active');
                    button.classList.remove('active');
                    button.innerHTML = settings.buttonText;
                } else {
                    iframeContainer.classList.add('active');
                    button.classList.add('active');
                    button.innerHTML = '+';
                }
            });
            
            // Botón cerrar
            const closeBtn = iframeContainer.querySelector('.reservas-widget-close');
            if (closeBtn) {
                closeBtn.addEventListener('click', function() {
                    iframeContainer.classList.remove('active');
                    button.classList.remove('active');
                    button.innerHTML = settings.buttonText;
                });
            }
            
            // Cerrar al hacer clic fuera (solo para modal)
            if (settings.mode === 'modal') {
                iframeContainer.addEventListener('click', function(e) {
                    if (e.target === iframeContainer) {
                        iframeContainer.classList.remove('active');
                        button.classList.remove('active');
                        button.innerHTML = settings.buttonText;
                    }
                });
            }
            
            // Auto abrir si está configurado
            if (settings.autoOpen) {
                setTimeout(() => {
                    button.click();
                }, 1000);
            }
        }
    }
    
    // Inicialización automática
    function init() {
        // Inyectar estilos
        injectStyles();
        
        // Buscar configuración en el script tag
        const currentScript = document.currentScript || 
            document.querySelector('script[src*="embed.js"]');
        
        if (currentScript) {
            const config = {};
            
            // Leer atributos data-*
            if (currentScript.hasAttribute('data-mode')) {
                config.mode = currentScript.getAttribute('data-mode');
            }
            if (currentScript.hasAttribute('data-container')) {
                config.containerId = currentScript.getAttribute('data-container');
            }
            if (currentScript.hasAttribute('data-button-text')) {
                config.buttonText = currentScript.getAttribute('data-button-text');
            }
            if (currentScript.hasAttribute('data-title')) {
                config.title = currentScript.getAttribute('data-title');
            }
            if (currentScript.hasAttribute('data-auto-open')) {
                config.autoOpen = currentScript.getAttribute('data-auto-open') === 'true';
            }
            if (currentScript.hasAttribute('data-height')) {
                config.height = currentScript.getAttribute('data-height');
            }
            
            // Crear widget con configuración
            createWidget(config);
        }
    }
    
    // Exponer API global
    window.ReservasWidget = {
        create: createWidget,
        init: init
    };
    
    // Inicializar cuando el DOM esté listo
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();