# Fase 0 y migración de tags

## Antes de migrar

1. Crear un backup o branch de Neon.
2. Ejecutar `npm run typecheck`, `npm test` y `npm run build`.
3. Verificar que `subject_day_materials` existe y conserva sus conteos por materia y semana.

## Aplicación

Ejecutar `scripts/029-create-material-tags.sql` una sola vez. La migración sólo crea tablas e índices; no modifica filas de materiales, audios, posiciones ni resaltados.

## Verificación

Ejecutar las consultas de verificación incluidas al final del script. Crear un tag desde la interfaz, asignarlo dos veces al mismo material y comprobar que existe una sola fila de asignación.

## Recuperación

Mientras no haya tags productivos, se pueden ejecutar las instrucciones de rollback comentadas en el script. Después de comenzar a usar tags, conservar las tablas y restaurar desde el backup en lugar de eliminarlas.
