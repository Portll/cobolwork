       IDENTIFICATION DIVISION.
       PROGRAM-ID. UTF8PIC.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  U-THREE             PIC UUU VALUE "ABC".
       01  U-TEN               PIC U(10).
       01  U-AFTER             PIC X(3).
       PROCEDURE DIVISION.
           MOVE U-THREE TO U-TEN
           MOVE "XYZ" TO U-AFTER
           STOP RUN.
