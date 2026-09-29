       IDENTIFICATION DIVISION.
       PROGRAM-ID. TWOWAYS.
      * Two inputs reach one command; only the first is checked.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-A                PIC X(40).
       01 WS-B                PIC X(40).
       01 WS-CMD              PIC X(80).
       PROCEDURE DIVISION.
           ACCEPT WS-A FROM COMMAND-LINE
           IF WS-A IS NOT ALPHABETIC
              GOBACK
           END-IF
           ACCEPT WS-B FROM ARGUMENT-VALUE
           STRING WS-A WS-B DELIMITED BY SIZE INTO WS-CMD
           CALL 'SYSTEM' USING WS-CMD
           GOBACK.
