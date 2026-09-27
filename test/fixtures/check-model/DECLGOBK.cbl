       IDENTIFICATION DIVISION.
       PROGRAM-ID. DECLGOBK.
       ENVIRONMENT DIVISION.
       INPUT-OUTPUT SECTION.
       FILE-CONTROL.
           SELECT IN-FILE ASSIGN TO INFILE
               FILE STATUS IS WS-FS.
       DATA DIVISION.
       FILE SECTION.
       FD IN-FILE.
       01 IN-REC               PIC X(10).
       WORKING-STORAGE SECTION.
       01 WS-FS                PIC XX.
       01 WS-I                 PIC 9(4).
       01 WS-TABLE.
          05 WS-ENTRY          PIC X(10) OCCURS 10.
       PROCEDURE DIVISION.
       DECLARATIVES.
       IO-ERROR SECTION.
           USE AFTER ERROR PROCEDURE ON IN-FILE.
           DISPLAY 'I/O ERROR ' WS-FS
           CALL 'CEE3ABD'.
       END DECLARATIVES.
       MAIN-PARA.
           ACCEPT WS-I FROM COMMAND-LINE
           OPEN INPUT IN-FILE
           READ IN-FILE
           MOVE IN-REC TO WS-ENTRY(WS-I)
           CLOSE IN-FILE
           GOBACK.
