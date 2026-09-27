       IDENTIFICATION DIVISION.
       PROGRAM-ID. CEEDMP.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-I                PIC 9(4).
       01 WS-TITLE            PIC X(80) VALUE 'DUMP'.
       01 WS-OPTS             PIC X(255) VALUE 'TRACEBACK'.
       01 WS-FC               PIC X(12).
       01 WS-TABLE.
          05 WS-ENTRY         PIC X(10) OCCURS 10.
       PROCEDURE DIVISION.
           ACCEPT WS-I FROM COMMAND-LINE
           CALL 'CEE3DMP' USING WS-TITLE WS-OPTS WS-FC
           MOVE 'X' TO WS-ENTRY(WS-I)
           GOBACK.
