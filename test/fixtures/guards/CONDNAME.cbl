       IDENTIFICATION DIVISION.
       PROGRAM-ID. CONDNAME.
      * Checked through a condition-name on the field.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-OPT              PIC X(8).
          88 OPT-KNOWN        VALUE 'REPORT' 'EXTRACT'.
       01 WS-CMD              PIC X(80).
       PROCEDURE DIVISION.
           ACCEPT WS-OPT FROM COMMAND-LINE
           IF NOT OPT-KNOWN
              GOBACK
           END-IF
           MOVE WS-OPT TO WS-CMD
           CALL 'SYSTEM' USING WS-CMD
           GOBACK.
