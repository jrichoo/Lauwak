@echo off
rem Starts a local MongoDB for Lauwak (no admin rights needed).
rem Uses an installed mongod if found, otherwise the portable copy in %LOCALAPPDATA%\Lauwak\mongodb.
set "DATA=%LOCALAPPDATA%\Lauwak\mongodb-data"
if not exist "%DATA%" mkdir "%DATA%"
set "MONGOD="
for /f "delims=" %%F in ('where mongod 2^>nul') do if not defined MONGOD set "MONGOD=%%F"
if not defined MONGOD for /r "%LOCALAPPDATA%\Lauwak\mongodb" %%F in (mongod.exe) do if not defined MONGOD if exist "%%F" set "MONGOD=%%F"
if not defined MONGOD (
  echo   MongoDB was not found. Download the Windows zip from https://www.mongodb.com/try/download/community
  echo   and extract it into %LOCALAPPDATA%\Lauwak\mongodb
  exit /b 1
)
"%MONGOD%" --dbpath "%DATA%" --bind_ip 127.0.0.1 --port 27017
