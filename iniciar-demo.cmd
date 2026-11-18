@echo off
rem Levanta el MVP completo (base de datos, API e interfaz) y abre el navegador.
rem Requiere Docker Desktop en ejecucion.
rem Sin --build: usa las imagenes ya construidas y no necesita internet. Solo construye si no existen.
cd /d "%~dp0"
docker compose up -d
if errorlevel 1 (
  echo.
  echo No fue posible levantar el Piloto. Verifique que Docker Desktop este abierto.
  pause
  exit /b 1
)
echo.
echo Esperando a que el API responda...
:esperar
curl -s -o nul http://localhost:8080/api/salud
if errorlevel 1 (
  timeout /t 2 /nobreak > nul
  goto esperar
)
echo Piloto SSES disponible en http://localhost:8080
start "" http://localhost:8080
