       IDENTIFICATION DIVISION.
       PROGRAM-ID. FDNOSEC.
       ENVIRONMENT DIVISION.
       INPUT-OUTPUT SECTION.
       FILE-CONTROL.
           SELECT MASTER-FILE ASSIGN TO "master.dat".
           SELECT LOG-FILE ASSIGN TO "log.dat".
       DATA DIVISION.
       COPY FDNOSEC.
       FD  LOG-FILE.
       01  LOG-REC                      PIC X(60).
       WORKING-STORAGE SECTION.
       01  WS-COUNT                     PIC 9(4) VALUE 0.
       PROCEDURE DIVISION.
           OPEN INPUT MASTER-FILE OUTPUT LOG-FILE
           READ MASTER-FILE
           IF MASTER-ACTIVE
               MOVE MASTER-NAME TO LOG-REC
               WRITE LOG-REC
           END-IF
           CLOSE MASTER-FILE LOG-FILE
           STOP RUN.
