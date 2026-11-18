@echo off
rem Deja la base de datos como recien instalada: borra lo registrado y vuelve a cargar los datos sinteticos.
rem Util para ensayar la demostracion las veces que haga falta.
cd /d "%~dp0"
docker compose exec api node dist/reiniciar.js
if errorlevel 1 (
  echo.
  echo No fue posible reiniciar los datos. Verifique que el Piloto este levantado con iniciar-demo.cmd
  pause
  exit /b 1
)
echo.
echo Datos reiniciados. Cierre la sesion en el navegador y vuelva a ingresar.
