       IDENTIFICATION DIVISION.
       PROGRAM-ID. CALLLOOP.
      * The program called is checked once, then called on each pass of a loop.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-PGM              PIC X(8).
       01 WS-REC              PIC X(80).
       PROCEDURE DIVISION.
           ACCEPT WS-PGM FROM COMMAND-LINE
           IF WS-PGM NOT = 'RPTLOAD'
              GOBACK
           END-IF
           PERFORM 3 TIMES
              CALL WS-PGM USING WS-REC BY CONTENT WS-PGM
           END-PERFORM
           GOBACK.
