       IDENTIFICATION DIVISION.
       PROGRAM-ID. ORPHAN.
      * Nothing in this tree starts or names it.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-CMD              PIC X(80).
       PROCEDURE DIVISION.
           ACCEPT WS-CMD FROM COMMAND-LINE
           CALL 'SYSTEM' USING WS-CMD
           GOBACK.
