       IDENTIFICATION DIVISION.
       PROGRAM-ID. BPROG.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-X               PIC X(40).
       01 WS-Y               PIC X(40).
       PROCEDURE DIVISION.
           MOVE 'ls' TO WS-Y
           CALL 'SUBPG' USING WS-Y
           CALL 'SYSTEM' USING WS-Y
           GOBACK.
