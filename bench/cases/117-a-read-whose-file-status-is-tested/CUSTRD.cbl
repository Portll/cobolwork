       IDENTIFICATION DIVISION.
       PROGRAM-ID. CUSTRD.
       ENVIRONMENT DIVISION.
       INPUT-OUTPUT SECTION.
       FILE-CONTROL.
           SELECT CUSTFILE ASSIGN TO CUSTDD
               FILE STATUS IS WS-FS.
       DATA DIVISION.
       FILE SECTION.
       FD CUSTFILE.
       01 CUST-REC.
          05 CUST-ID         PIC X(8).
          05 CUST-NAME       PIC X(30).
       WORKING-STORAGE SECTION.
       01 WS-FS              PIC XX.
          88 WS-FS-OK        VALUE '00'.
       01 WS-NAME            PIC X(30).
       PROCEDURE DIVISION.
           OPEN INPUT CUSTFILE
           IF NOT WS-FS-OK
               STOP RUN
           END-IF
           READ CUSTFILE
           IF NOT WS-FS-OK
               STOP RUN
           END-IF
           MOVE CUST-NAME TO WS-NAME
           DISPLAY WS-NAME
           CLOSE CUSTFILE
           GOBACK.
