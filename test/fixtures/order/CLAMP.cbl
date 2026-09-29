       IDENTIFICATION DIVISION.
       PROGRAM-ID. CLAMP.
      * A length from the command line is clamped to the field it
      * measures before it is used, as BankDemo's ZBNKPRT1 does.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-LEN              PIC 9(4).
       01 WS-SRC              PIC X(200).
       01 WS-DATA             PIC X(80).
       PROCEDURE DIVISION.
           ACCEPT WS-LEN FROM COMMAND-LINE
           IF WS-LEN IS GREATER THAN LENGTH OF WS-DATA
              MOVE LENGTH OF WS-DATA TO WS-LEN
           END-IF
           MOVE WS-SRC(1:WS-LEN) TO WS-DATA
           GOBACK.
