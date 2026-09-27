       IDENTIFICATION DIVISION.
       PROGRAM-ID. ECHO.
      * Shows the person at the terminal what they typed.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-INPUT-PASSWORD   PIC X(12) VALUE SPACES.
       01 WS-PIN              PIC X(4).
       PROCEDURE DIVISION.
           DISPLAY "Enter password: "
           ACCEPT WS-INPUT-PASSWORD
           INSPECT WS-INPUT-PASSWORD REPLACING ALL X"0D" BY SPACE
           DISPLAY FUNCTION TRIM(WS-INPUT-PASSWORD)
           DISPLAY "PIN: " AT 0101
           ACCEPT WS-PIN SECURE AT 0106
           DISPLAY "You entered: " AT 0204 WS-PIN AT 0217
           GOBACK.
