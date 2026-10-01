       IDENTIFICATION DIVISION.
       PROGRAM-ID. DPROG.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-X               PIC X(40).
       01 WS-Y               PIC X(40).
       PROCEDURE DIVISION.
           MOVE 'ls' TO WS-X
           CALL 'MIDPG' USING WS-X WS-Y
           CALL 'SYSTEM' USING WS-Y
           GOBACK.
