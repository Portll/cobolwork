       IDENTIFICATION DIVISION.
       PROGRAM-ID. TABLEHIT.
      * Input fills a field, and the same bytes are read back as a
      * table element through a REDEFINES.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-REC.
          05 WS-HEAD          PIC X(20).
       01 WS-REC-T REDEFINES WS-REC.
          05 WS-PART          PIC X(5) OCCURS 4.
       01 WS-CMD              PIC X(80).
       PROCEDURE DIVISION.
           ACCEPT WS-HEAD FROM COMMAND-LINE
           MOVE WS-PART(2) TO WS-CMD
           CALL 'SYSTEM' USING WS-CMD
           GOBACK.
