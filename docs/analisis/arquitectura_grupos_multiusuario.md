# 👥 ARQUITECTURA MULTIUSUARIO: TRABAJO EN EQUIPO EN EL LOTE
## Propuesta Técnica y Análisis de Alternativas de Diseño

En el ámbito agropecuario, la realidad del campo exige que múltiples actores (dueño del campo, encargado, ingenieros agrónomos, tractoristas y empleados contratados) registren e interactúen sobre los **mismos lotes, hacienda y finanzas**. 

Actualmente, **AgroHabilis** asume una relación **1:1** estricta entre un número de teléfono de WhatsApp y una cuenta de usuario con sus recursos correspondientes (`usuario_id`). Si un empleado y el dueño escriben desde números diferentes, el sistema hoy los trata como dos islas separadas, impidiéndoles colaborar sobre un mismo establecimiento.

A continuación, se presentan **dos enfoques de arquitectura** para resolver esta problemática, detallando cambios de base de datos (PostgreSQL), adaptaciones de lógica de backend en Node.js y flujos conversacionales.

---

## 🗺️ MAPA DE SOLUCIONES

```
                                  ¿Cómo agrupar números de WhatsApp?
                                                   │
                ┌──────────────────────────────────┴──────────────────────────────────┐
                ▼                                                                     ▼
     [OPCIÓN A: Tenencia de Grupo / Org]                                    [OPCIÓN B: Delegación / Alias]
     (El modelo SaaS ideal a largo plazo)                                   (La solución pragmática y rápida)
                │                                                                     │
  • Se crea la entidad "Establecimiento/Grupo".                         • El dueño sigue siendo el "Usuario Principal".
  • Lotes y Gastos pertenecen al Grupo, no al usuario.                  • Números autorizados escriben "a nombre de".
  • Permite roles y permisos reales (Lectura/Escritura).                • Cero impacto en las FKs existentes.
```

---

## 🏗️ OPCIÓN A: El Enfoque Limpio (Modelo de Organización / Tenencia de Grupo)

Este es el **estándar industrial para plataformas SaaS**. Consiste en desacoplar la **identidad** de la persona que chatea del **propietario de los datos**. Los recursos (lotes, gastos, stock ganadero) ya no pertenecen a un `usuario_id`, sino a un `grupo_id` (o `organizacion_id`).

### 1. Diagrama de Relación (ERD)

```mermaid
erDiagram
    grupos {
        int id PK
        varchar nombre
        timestamp creado_en
    }
    usuarios {
        int id PK
        int grupo_id FK
        varchar nombre
        varchar whatsapp UNIQUE
        varchar rol "dueño, encargado, operario"
    }
    lotes {
        int id PK
        int grupo_id FK "Antes: usuario_id"
        varchar nombre
        decimal hectareas
    }
    gastos {
        int id PK
        int grupo_id FK "Antes: usuario_id"
        int lote_id FK
        decimal monto
    }
    grupos ||--o{ usuarios : "tiene miembros"
    grupos ||--o{ lotes : "posee"
    grupos ||--o{ gastos : "registra"
```

### 2. Cambios de Esquema en PostgreSQL

Para migrar a este modelo, se deben ejecutar los siguientes cambios en la base de datos:

```sql
-- 1. Crear la tabla de Grupos / Establecimientos
CREATE TABLE IF NOT EXISTS grupos (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(100) NOT NULL,
  creado_en TIMESTAMP DEFAULT NOW()
);

-- 2. Modificar la tabla usuarios para relacionarla con un grupo y añadirle un Rol
ALTER TABLE usuarios 
  ADD COLUMN IF NOT EXISTS grupo_id INTEGER REFERENCES grupos(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rol VARCHAR(20) DEFAULT 'dueño'; -- 'dueño', 'encargado', 'operario'

-- 3. Migración de datos existentes: Crear un grupo por cada usuario actual
-- (Esto garantiza que no se rompa nada de lo que ya está en producción)
DO $$
DECLARE
    u RECORD;
    new_grupo_id INT;
BEGIN
    FOR u IN SELECT id, nombre FROM usuarios WHERE grupo_id IS NULL LOOP
        INSERT INTO grupos (nombre) 
        VALUES ('Establecimiento ' || u.nombre) 
        RETURNING id INTO new_grupo_id;
        
        UPDATE usuarios SET grupo_id = new_grupo_id, rol = 'dueño' WHERE id = u.id;
    END LOOP;
END $$;

-- 4. Modificar las tablas de recursos para apuntar a GRUPO en lugar de USUARIO
-- Lotes
ALTER TABLE lotes ADD COLUMN IF NOT EXISTS grupo_id INTEGER REFERENCES grupos(id) ON DELETE CASCADE;
UPDATE lotes l SET grupo_id = u.grupo_id FROM usuarios u WHERE l.usuario_id = u.id;
ALTER TABLE lotes DROP COLUMN IF EXISTS usuario_id; -- (Opcional, o mantener para saber quién creó el registro)

-- Gastos
ALTER TABLE gastos ADD COLUMN IF NOT EXISTS grupo_id INTEGER REFERENCES grupos(id) ON DELETE CASCADE;
UPDATE gastos g SET grupo_id = u.grupo_id FROM usuarios u WHERE g.usuario_id = u.id;
ALTER TABLE gastos DROP COLUMN IF EXISTS usuario_id;

-- Repetir para: stock_ganadero, ventas, campanas_agricolas, usuario_cultivos, etc.
```

### 3. Modificaciones en el Backend (Node.js)

Cuando ingresa un mensaje a través de WhatsApp, en lugar de consultar los datos basados en `usuario.id`, toda la lógica de negocio y las herramientas del Agente de IA filtran y operan usando el `usuario.grupo_id`.

```javascript
// Ejemplo de obtención de lotes filtrado por el Grupo
const obtenerLotesDelGrupo = async (usuario) => {
  const result = await query(
    `SELECT id, nombre, hectareas, cultivo FROM lotes WHERE grupo_id = $1`,
    [usuario.grupo_id]
  );
  return result.rows;
};
```

---

## ⚡ OPCIÓN B: El Enfoque Pragmático (Alias de Teléfonos / Delegación de Identidad)

Si querés implementar esto **sin reescribir todas las claves foráneas** de la base de datos (lo cual requiere migraciones pesadas en producción), podemos usar el modelo de **Delegación**. 

Aquí, el Dueño de la cuenta sigue siendo el `usuario_id` principal que posee todos los lotes y gastos. Los empleados o encargados se registran en una tabla secundaria de **"Teléfonos Autorizados"** enlazada a la cuenta del Dueño. Cuando un operario escribe, el sistema lo detecta y lo hace actuar **"en representación de"** la cuenta del Dueño.

### 1. Diagrama de Relación (ERD)

```mermaid
erDiagram
    usuarios {
        int id PK "Dueño del Campo"
        varchar nombre
        varchar whatsapp UNIQUE
    }
    telefonos_autorizados {
        int id PK
        int usuario_principal_id FK "Apunta al id del Dueño"
        varchar whatsapp_autorizado UNIQUE "Número del Empleado"
        varchar nombre_contacto "Ej: Juan Encargado"
        varchar rol "encargado, operario"
        boolean activo
    }
    lotes {
        int id PK
        int usuario_id FK "Apunta al id del Dueño"
        varchar nombre
    }
    usuarios ||--o{ telefonos_autorizados : "autoriza a"
    usuarios ||--o{ lotes : "posee"
```

### 2. Cambios de Esquema en PostgreSQL

```sql
CREATE TABLE IF NOT EXISTS telefonos_autorizados (
  id SERIAL PRIMARY KEY,
  usuario_principal_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  whatsapp_autorizado VARCHAR(20) NOT NULL UNIQUE,
  nombre_contacto VARCHAR(100) NOT NULL,
  rol VARCHAR(20) DEFAULT 'operario', -- 'encargado', 'operario'
  activo BOOLEAN DEFAULT true,
  creado_en TIMESTAMP DEFAULT NOW()
);

-- Índice de alto rendimiento para búsquedas conversacionales rápidas
CREATE INDEX IF NOT EXISTS idx_telefonos_autorizados_whatsapp 
  ON telefonos_autorizados (whatsapp_autorizado) 
  WHERE activo = true;
```

### 3. Modificaciones en el Backend (Node.js)

Este enfoque brilla por su sencillez en la integración. Solo requiere modificar el modelo `src/models/usuario.js` en su función `buscarPorWhatsapp`.

```javascript
// src/models/usuario.js (Propuesta de refactorización)

const buscarPorWhatsapp = async (numeroWhatsapp) => {
  const identidad = extraerIdentidadWhatsapp(numeroWhatsapp);
  if (!identidad.numero && !identidad.jid) return null;

  const numeroBuscado = identidad.numero || "";

  // 1. Primero buscamos si el número pertenece a un Usuario Principal
  let result = await query(
    `
      SELECT id, nombre, email, whatsapp, whatsapp_jid, whatsapp_real, provincia, partido, lat, lng, plan, activo, tipo_comercializacion
      FROM usuarios
      WHERE (
        $1::text <> '' AND (
          regexp_replace(COALESCE(whatsapp, ''), '\\D', '', 'g') = $1
          OR regexp_replace(COALESCE(whatsapp_real, ''), '\\D', '', 'g') = $1
          OR regexp_replace(COALESCE(whatsapp_jid, ''), '\\D', '', 'g') = $1
        )
      )
      OR ($2::text IS NOT NULL AND whatsapp_jid = $2::text)
      LIMIT 1
    `,
    [numeroBuscado, identidad.jid]
  );

  if (result.rows[0]) {
    // Es un usuario principal directo
    return {
      ...result.rows[0],
      es_delegado: false,
      nombre_operario: result.rows[0].nombre,
      rol_operario: 'dueño'
    };
  }

  // 2. Si no es un usuario principal, verificamos si es un Teléfono Autorizado (Delegado)
  const delegadoResult = await query(
    `
      SELECT t.usuario_principal_id, t.nombre_contacto, t.rol,
             u.nombre AS nombre_principal, u.email, u.whatsapp AS whatsapp_principal,
             u.provincia, u.partido, u.lat, u.lng, u.plan, u.activo, u.tipo_comercializacion
      FROM telefonos_autorizados t
      JOIN usuarios u ON t.usuario_principal_id = u.id
      WHERE regexp_replace(COALESCE(t.whatsapp_autorizado, ''), '\\D', '', 'g') = $1
        AND t.activo = true
        AND u.activo = true
      LIMIT 1
    `,
    [numeroBuscado]
  );

  if (delegadoResult.rows[0]) {
    const row = delegadoResult.rows[0];
    // Retornamos la estructura del usuario dueño, pero con metadatos del operario actual
    return {
      id: row.usuario_principal_id, // <--- Clave: el Agente operará sobre el ID del dueño
      nombre: row.nombre_principal, // Nombre de la cuenta/campo
      email: row.email,
      whatsapp: row.whatsapp_principal,
      provincia: row.provincia,
      partido: row.partido,
      lat: row.lat,
      lng: row.lng,
      plan: row.plan,
      activo: row.activo,
      tipo_comercializacion: row.tipo_comercializacion,
      // Metadatos de auditoría
      es_delegado: true,
      nombre_operario: row.nombre_contacto,
      rol_operario: row.rol
    };
  }

  return null;
};
```

Con este simple ajuste, el resto de la aplicación (que consulta `usuario.id` para guardar un gasto, registrar siembras o consultar el clima) **sigue funcionando exactamente igual sin enterarse del cambio de arquitectura de fondo**.

---

## 🕵️ AUDITORÍA E IDENTIDAD: "¿Quién hizo qué?"

Tanto en la **Opción A** como en la **Opción B**, es vital saber quién registró una acción. Si un operario guarda un gasto de gasoil, el dueño debe ver en el portal web que lo hizo "Juan (Encargado)".

### 1. Enriquecer los logs y la descripción de transacciones

Al guardar un gasto o labor, podemos inyectar de forma transparente quién es el operario en el campo `descripcion`.

**Ejemplo en el Agente de IA al registrar un Gasto:**
```javascript
// Si el usuario es un operario delegado
const descripcionFinal = usuario.es_delegado 
  ? `${descripcionOriginal} (Registrado por ${usuario.nombre_operario})`
  : descripcionOriginal;

// Guardar en la base de datos
await guardarGasto({
  usuario_id: usuario.id, // ID del principal
  monto: monto,
  descripcion: descripcionFinal,
  lote_id: loteId
});
```

### 2. Flujo Conversacional Adaptativo en WhatsApp

La IA puede adaptar su tono y saludos en base al rol del usuario que escribe:

*   **Si escribe el Dueño:**
    > 🧑🌾 **Dueño:** *«Registra un gasto de 200 mil pesos en semilla en el lote 3»*  
    > 🤖 **AgroHabilis:** *«Hola Esteban. He registrado un gasto de **$200.000** en semillas en el **Lote 3**. Tu balance consolidado se ha actualizado en tiempo real.»*
*   **Si escribe el Encargado/Operario:**
    > 🚜 **Encargado (WhatsApp de Juan):** *«Registra un gasto de 200 mil pesos en semilla en el lote 3»*  
    > 🤖 **AgroHabilis:** *«Hola Juan. He registrado el gasto de **$200.000** en semillas en el **Lote 3** a nombre de **Establecimiento Don Esteban**. Le notificaré al administrador.»*

---

## ⚖️ COMPARATIVA TÉCNICA Y DE NEGOCIO

| Criterio | 🏗️ Opción A (SaaS Completo) | ⚡ Opción B (Delegación Pragmática) |
| :--- | :--- | :--- |
| **Complejidad de DB** | 🔴 **Alta.** Requiere alterar llaves foráneas en ~10 tablas y migrar datos históricos con cuidado. | 🟢 **Baja.** Solo requiere añadir una tabla nueva y modificar un archivo de consulta. |
| **Tiempo de Desarrollo** | ~2 semanas (incluye testing de integridades referenciales). | **~1 a 2 días.** Cambios localizados y sin riesgo de regresiones graves. |
| **Roles y Permisos** | 🟢 **Total.** Permite configurar permisos avanzados nativos en cada tabla en el futuro. | 🟡 **Medio.** Se pueden emular roles en el backend, pero a nivel físico de DB comparten el mismo dueño. |
| **Seguridad de Datos** | 🟢 **Robusta.** El aislamiento de datos está garantizado por la pertenencia jerárquica al grupo. | 🟢 **Buena.** El control de acceso está gobernado por el mapa de teléfonos autorizados. |
| **Portal Web** | Los usuarios del mismo grupo pueden loguearse con sus propias credenciales y ver lo mismo. | El dueño comparte un token de acceso o los operarios entran con sus números mapeados. |
| **Escalabilidad** | Ideal si el proyecto busca vender licencias multiusuario corporativas a grandes estancias. | Ideal para validar rápido el mercado y dar valor inmediato a los clientes actuales. |

---

## 🎯 RECOMENDACIÓN Y PRÓXIMOS PASOS

1.  **Si querés salir a producción YA y validar esta feature con tus clientes de forma inmediata:**
    *   La **Opción B (Delegación de Identidad)** es la ganadora indiscutible. La velocidad de implementación, el nulo riesgo de romper datos existentes en producción y el impacto cero sobre el resto de las features hacen que sea la vía más inteligente para validar la hipótesis de negocio.
2.  **Si estás pensando en una ronda de inversión o arquitectura corporativa a largo plazo:**
    *   La **Opción A** es la correcta estructuralmente. Sin embargo, un enfoque pragmante sería empezar con la **Opción B** hoy, y planificar la migración a la **Opción A** una vez que el flujo de usuarios compartidos esté consolidado y el modelo de negocio lo demande.

---

## 🚀 DETALLE DE LA IMPLEMENTACIÓN COMPLETADA (OPCIÓN B)

Hemos implementado con éxito la **Opción B (Delegación de Identidad / Teléfonos Mapeados)**, cumpliendo con los más altos estándares de calidad, seguridad y experiencia de usuario.

### 1. Migración y Estructura de Base de Datos
Se creó la tabla `telefonos_autorizados` y su respectivo índice de alto rendimiento para búsquedas rápidas:
```sql
CREATE TABLE IF NOT EXISTS telefonos_autorizados (
  id SERIAL PRIMARY KEY,
  usuario_principal_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  whatsapp_autorizado VARCHAR(20) NOT NULL UNIQUE,
  nombre_contacto VARCHAR(100) NOT NULL,
  rol VARCHAR(20) DEFAULT 'operario', -- 'encargado', 'operario'
  activo BOOLEAN DEFAULT true,
  creado_en TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_telefonos_autorizados_whatsapp 
  ON telefonos_autorizados (whatsapp_autorizado) 
  WHERE activo = true;
```

### 2. Capa de Modelado y Resolución Transparentes
La función `buscarPorWhatsapp` en `src/models/usuario.js` fue refacturada para implementar un fallback transparente. Si el número entrante no pertenece a un usuario principal, se realiza la consulta en `telefonos_autorizados`. Si existe y está activo, el sistema retorna la entidad del dueño principal con metadatos del operario incorporados (`es_delegado: true`, `nombre_operario`, `rol_operario`).
Esto garantiza **100% de compatibilidad** hacia atrás con toda la base de código existente.

### 3. Enriquecimiento Conversacional y Auditoría AI
- **Modificación en Gastos y Ventas (`src/services/gastos.js`):** Cuando un operario registra un gasto o una venta, el backend añade automáticamente el metadato de auditoría en la descripción:
  - Para gastos: `" (Registrado por Carlos Perez)"` al final de la descripción.
  - Para ventas: `"[Reg: Carlos Perez]"` dentro de la descripción del producto.
- **Dinamización de Flujos de IA (`src/services/rutas/registrar.js`, `src/services/agent/ia/`):** El sistema inyecta instrucciones dinámicas a las plantillas y diálogos de Gemini/OpenRouter para saludar al operario por su nombre y ratificar que la información fue guardada en el establecimiento del dueño principal de forma clara y cordial.

### 4. Endpoints de Express (REST API)
Añadimos tres nuevos endpoints en `src/index.js` protegidos por el middleware de autenticación del panel de cliente:
- `GET /api/dashboard/cliente/telefonos`: Lista todos los números autorizados vinculados al usuario autenticado.
- `POST /api/dashboard/cliente/telefonos`: Valida y normaliza el número ingresado. Bloquea la acción si el número ya está registrado como una cuenta principal en el sistema para evitar usurpaciones de identidad o conflictos. Realiza un upsert/registro seguro.
- `DELETE /api/dashboard/cliente/telefonos/:id`: Elimina la autorización del operario de forma permanente.

### 5. Interfaz de Panel Web ("Mi Equipo de Campo")
Se diseñó una sección de gestión premium, responsiva y estética en `cliente.html` dentro de la pestaña "Equipo de Campo":
- **Lado Izquierdo:** Tabla de listado en tiempo real con links directos a WhatsApp, etiquetas de rol estilizadas, indicador de estado ("Activo") y botón de revocación con alertas de seguridad.
- **Lado Derecho:** Formulario de alta rápida e intuitivo con inputs normalizados.

### 6. Pruebas de Integración y Calidad Automatizadas
Creamos dos test suites de integración ejecutables con conexión real a PostgreSQL:
1. `scratch/test-delegacion-usuarios.js`: Valida la resolución de identidades de dueños y delegados y su mapeo de sesión.
2. `scratch/test-api-telefonos.js`: Valida los flujos y restricciones de la API REST (inserción, prevención de cuentas principales duplicadas, listado y revocación).

**Ambas suites de pruebas se ejecutan y completan con 100% de éxito.**
